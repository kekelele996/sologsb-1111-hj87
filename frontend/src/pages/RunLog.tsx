import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import RecoveryBadge from '../components/common/RecoveryBadge';
import DepthRangeInput from '../components/common/DepthRangeInput';
import EmptyPanel from '../components/common/EmptyPanel';
import RevisionTable from '../components/common/RevisionTable';
import { useDepthCalc } from '../hooks/useDepthCalc';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore, revisionsOfRun } from '../stores/runStore';
import { useLithoStore } from '../stores/lithoStore';
import { SHIFTS } from '../types/drill-hole';
import type { DrillRun, RunShift } from '../types/drill-run';
import type { LithoLog } from '../types/litho-log';
import { findLithoOverlaps, footageOf, recoveryOf, validateRange } from '../utils/recovery';

const { Title, Paragraph, Text } = Typography;

interface RunFormValues {
  runNo: string;
  holeId: string;
  fromDepth: number;
  toDepth: number;
  coreLength: number;
  waterLevel: number;
  shift: RunShift;
  drilledAt: Dayjs;
  recorder: string;
  remark?: string;
  /** 与岩性编录重叠时必填：修订原因 */
  revisionReason?: string;
  /** 与岩性编录重叠时必填：操作人 */
  revisionOperator?: string;
}

/** 回次记录：起止深度自动算进尺与采取率；与岩性编录重叠的回次调整 / 作废需留痕 */
export default function RunLog() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const currentHoleId = useHoleStore((s) => s.currentHoleId);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const runs = useRunStore((s) => s.runs);
  const revisions = useRunStore((s) => s.revisions);
  const addRun = useRunStore((s) => s.addRun);
  const updateRun = useRunStore((s) => s.updateRun);
  const removeRun = useRunStore((s) => s.removeRun);
  const lithos = useLithoStore((s) => s.lithos);
  const { runsOf, summarize } = useDepthCalc();

  const [form] = Form.useForm<RunFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DrillRun | null>(null);
  /** 编辑中的回次与岩性编录的重叠段（非空则保存必须填写修订原因并留痕） */
  const [editingOverlaps, setEditingOverlaps] = useState<LithoLog[]>([]);
  /** 深度区间以本地 state 为唯一数据源：避免 Form.useWatch 在弹窗首次挂载前读不到值 */
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [liveCore, setLiveCore] = useState(0);
  /** 待作废的回次（与岩性编录重叠时走作废弹窗，填写原因后留痕） */
  const [voidTarget, setVoidTarget] = useState<DrillRun | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidOperator, setVoidOperator] = useState('');
  /** 留痕抽屉：单回次或整孔 */
  const [historyRun, setHistoryRun] = useState<DrillRun | null>(null);
  const [holeHistoryOpen, setHoleHistoryOpen] = useState(false);

  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · ${hole.rigNo}`, value: hole.id }));
  const activeHoleId = currentHoleId || holes[0]?.id || '';
  const summary = useMemo(() => summarize(activeHoleId), [summarize, activeHoleId]);
  const tableRuns = useMemo(() => [...summary.runs].sort((a, b) => b.fromDepth - a.fromDepth), [summary.runs]);

  /** 每个回次与岩性编录的重叠段（用于操作列判定留痕门槛） */
  const overlapMap = useMemo(() => {
    const map = new Map<string, LithoLog[]>();
    runs.forEach((run) => {
      const overlaps = findLithoOverlaps(run, lithos);
      if (overlaps.length) map.set(run.id, overlaps);
    });
    return map;
  }, [runs, lithos]);

  const holeRevisions = useMemo(
    () => revisions.filter((rev) => rev.holeId === activeHoleId).sort((a, b) => b.revisedAt.localeCompare(a.revisedAt)),
    [revisions, activeHoleId],
  );
  const historyRevisions = useMemo(
    () => (historyRun ? revisionsOfRun(revisions, historyRun.id).slice().reverse() : []),
    [revisions, historyRun],
  );

  const openCreate = () => {
    setEditing(null);
    setEditingOverlaps([]);
    form.resetFields();
    const hole = holes.find((h) => h.id === activeHoleId);
    const nextFrom = summary.reachedDepth;
    const nextTo = Number((nextFrom + 5).toFixed(2));
    const prefix = (hole?.holeNo ?? 'ZK').replace(/^ZK-/, '');
    setRange({ from: nextFrom, to: nextTo });
    setLiveCore(Number((5 * 0.9).toFixed(2)));
    form.setFieldsValue({
      runNo: `${prefix}-${String(summary.runCount + 1).padStart(2, '0')}`,
      holeId: activeHoleId,
      fromDepth: nextFrom,
      toDepth: nextTo,
      coreLength: Number((5 * 0.9).toFixed(2)),
      waterLevel: 15,
      shift: hole?.shift === '甲班' || hole?.shift === '乙班' || hole?.shift === '丙班' ? hole.shift : '甲班',
      drilledAt: dayjs(),
      recorder: '高振华',
    } as unknown as RunFormValues);
    setOpen(true);
  };

  const openEdit = (record: DrillRun) => {
    setEditing(record);
    setEditingOverlaps(findLithoOverlaps(record, lithos));
    setRange({ from: record.fromDepth, to: record.toDepth });
    setLiveCore(record.coreLength);
    form.setFieldsValue({
      runNo: record.runNo,
      holeId: record.holeId,
      fromDepth: record.fromDepth,
      toDepth: record.toDepth,
      coreLength: record.coreLength,
      waterLevel: record.waterLevel,
      shift: record.shift,
      drilledAt: dayjs(record.drilledAt),
      recorder: record.recorder,
      remark: record.remark,
      revisionReason: undefined,
      revisionOperator: record.recorder,
    } as unknown as RunFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const rangeError = validateRange(range.from, range.to);
    if (rangeError) {
      message.error(rangeError);
      return;
    }
    const payload = {
      runNo: values.runNo,
      holeId: values.holeId,
      fromDepth: range.from,
      toDepth: range.to,
      coreLength: Number(values.coreLength) || 0,
      waterLevel: Number(values.waterLevel) || 0,
      shift: values.shift,
      drilledAt: values.drilledAt.toISOString(),
      recorder: values.recorder,
      remark: values.remark,
    };
    const footage = footageOf(payload.fromDepth, payload.toDepth);
    const recovery = recoveryOf(payload.coreLength, footage);
    if (editing) {
      const revision = editingOverlaps.length
        ? { reason: values.revisionReason ?? '', operator: values.revisionOperator ?? '' }
        : undefined;
      await updateRun(editing.id, payload, revision);
      message.success(
        revision
          ? `已更新回次 ${payload.runNo}，进尺 ${footage}m，采取率 ${recovery}%，修订留痕已记录`
          : `已更新回次 ${payload.runNo}，进尺 ${footage}m，采取率 ${recovery}%`,
      );
    } else {
      await addRun(payload);
      message.success(`已录入回次 ${payload.runNo}，进尺 ${footage}m，采取率 ${recovery}%`);
    }
    setOpen(false);
  };

  const openVoid = (record: DrillRun) => {
    setVoidTarget(record);
    setVoidReason('');
    setVoidOperator(record.recorder);
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      message.error('与岩性编录重叠的回次作废必须填写原因');
      return;
    }
    if (!voidOperator.trim()) {
      message.error('请填写操作人');
      return;
    }
    await removeRun(voidTarget.id, { reason: voidReason, operator: voidOperator });
    message.success(`已作废回次 ${voidTarget.runNo}，原值与原因已留痕`);
    setVoidTarget(null);
  };

  const columns: TableColumnsType<DrillRun> = [
    { title: '回次号', dataIndex: 'runNo', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    { title: '深度区间(m)', width: 140, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '进尺(m)', dataIndex: 'footage', width: 100, align: 'right' },
    { title: '岩芯长度(m)', dataIndex: 'coreLength', width: 120, align: 'right' },
    { title: '采取率', dataIndex: 'recovery', width: 140, render: (v: number) => <RecoveryBadge recovery={v} showAdvice /> },
    { title: '回次水位(m)', dataIndex: 'waterLevel', width: 120, align: 'right' },
    { title: '班次', dataIndex: 'shift', width: 80 },
    { title: '钻进日期', dataIndex: 'drilledAt', width: 120, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '记录人', dataIndex: 'recorder', width: 90 },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v?: string) => v ?? '-' },
    {
      title: '编录重叠',
      width: 100,
      render: (_, record) =>
        (overlapMap.get(record.id)?.length ?? 0) > 0 ? <Tag color="orange">已编录</Tag> : <Tag>未重叠</Tag>,
    },
    {
      title: '留痕',
      width: 90,
      render: (_, record) => {
        const count = revisionsOfRun(revisions, record.id).length;
        return count ? (
          <Button size="small" type="link" onClick={() => setHistoryRun(record)}>
            留痕({count})
          </Button>
        ) : (
          <Text type="secondary">-</Text>
        );
      },
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, record) => {
        const overlapped = (overlapMap.get(record.id)?.length ?? 0) > 0;
        return (
          <Space size={2}>
            <Button size="small" type="link" onClick={() => openEdit(record)}>
              编辑
            </Button>
            {overlapped ? (
              <Button size="small" type="link" danger onClick={() => openVoid(record)}>
                作废
              </Button>
            ) : (
              <Popconfirm title={`确认删除回次 ${record.runNo}？`} onConfirm={() => removeRun(record.id).then(() => message.success('已删除'))}>
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const previewFootage = footageOf(range.from, range.to);
  const previewRecovery = recoveryOf(liveCore, previewFootage);

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        回次记录
      </Title>
      <Paragraph type="secondary">
        录入起止深度与岩芯长度，系统自动计算进尺与采取率；采取率低于 75% 立即标红并进入异常清单。与岩性编录深度重叠的回次，调整或作废时需填写原因并留痕（原值、新值、时间、操作人），未重叠的回次照常调整。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>当前钻孔</span>
        <Select style={{ width: 200 }} value={activeHoleId} onChange={setCurrentHole} options={holeOptions} placeholder="选择钻孔" />
        <Button type="primary" onClick={openCreate} disabled={!activeHoleId}>
          录入回次
        </Button>
        <Button onClick={() => setHoleHistoryOpen(true)} disabled={!activeHoleId}>
          修订留痕{holeRevisions.length ? `（${holeRevisions.length}）` : ''}
        </Button>
        <Text type="secondary">
          深度覆盖：{summary.coverage.length ? summary.coverage.map((r) => `${r.from}~${r.to}m`).join('、') : '尚无回次'}
        </Text>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="回次数" value={summary.runCount} unit="个" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="累计进尺" value={summary.totalFootage} unit="m" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="加权平均采取率"
            value={summary.averageRecovery}
            unit="%"
            status={summary.averageRecovery >= 90 ? 'success' : summary.averageRecovery >= 75 ? 'default' : 'error'}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="异常回次（<75%）" value={summary.anomalyCount} unit="个" status={summary.anomalyCount ? 'error' : 'success'} />
        </Col>
      </Row>

      {tableRuns.length === 0 ? (
        <EmptyPanel description="该孔暂无回次记录" actionText="录入回次" onAction={openCreate} />
      ) : (
        <Card size="small">
          <Table rowKey="id" size="small" columns={columns} dataSource={tableRuns} pagination={{ pageSize: 10 }} scroll={{ x: 1500 }} />
        </Card>
      )}

      <Modal open={open} title={editing ? `编辑回次 · ${editing.runNo}` : '录入回次'} onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={720}>
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('coreLength' in changed) setLiveCore(Number(changed.coreLength) || 0);
          }}
        >
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="runNo" label="回次号" rules={[{ required: true, message: '请输入回次号' }]}>
              <Input style={{ width: 160 }} maxLength={20} placeholder="如：2401-32" />
            </Form.Item>
            <Form.Item name="holeId" label="钻孔" rules={[{ required: true, message: '请选择钻孔' }]}>
              <Select style={{ width: 200 }} options={holeOptions} />
            </Form.Item>
            <Form.Item name="shift" label="班次" rules={[{ required: true, message: '请选择班次' }]}>
              <Select style={{ width: 120 }} options={SHIFTS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
          </Space>

          <Form.Item label="深度区间" required>
            <DepthRangeInput
              fromDepth={range.from}
              toDepth={range.to}
              referenceRuns={runsOf(Form.useWatch('holeId', form) ?? activeHoleId)}
              ignoreRunId={editing?.id}
              maxDepth={holes.find((h) => h.id === (Form.useWatch('holeId', form) ?? activeHoleId))?.designDepth}
              onChange={(patch) => {
                setRange((prev) => ({ ...prev, ...patch }));
                form.setFieldsValue(patch as unknown as RunFormValues);
              }}
            />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="coreLength" label="岩芯长度(m)" rules={[{ required: true, message: '请输入岩芯长度' }]}>
              <InputNumber min={0} step={0.1} style={{ width: 160 }} placeholder="岩芯长度" />
            </Form.Item>
            <Form.Item name="waterLevel" label="回次水位(m)" rules={[{ required: true, message: '请输入回次水位' }]}>
              <InputNumber min={0} step={0.1} style={{ width: 160 }} placeholder="回次水位" />
            </Form.Item>
            <Form.Item name="drilledAt" label="钻进日期" rules={[{ required: true, message: '请选择钻进日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="recorder" label="记录人" rules={[{ required: true, message: '请输入记录人' }]}>
              <Input style={{ width: 130 }} maxLength={16} placeholder="记录人" />
            </Form.Item>
          </Space>

          <Alert
            type={previewRecovery >= 75 ? 'success' : 'error'}
            showIcon
            message={
              <Space size={8}>
                <span>
                  自动计算：进尺 {previewFootage} m，采取率 {previewRecovery}%
                </span>
                <RecoveryBadge recovery={previewRecovery} showAdvice />
              </Space>
            }
            description={previewRecovery < 75 ? '采取率低于 75%，保存后该回次将进入工作台异常清单' : '采取率达标'}
          />

          {editing && editingOverlaps.length > 0 ? (
            <>
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="该回次与岩性编录深度重叠，保存将留痕"
                description={
                  <span>
                    重叠编录段：
                    {editingOverlaps.map((log) => (
                      <Tag key={log.id} color="orange" style={{ marginLeft: 4 }}>
                        {log.lithology} {log.fromDepth}~{log.toDepth}m
                      </Tag>
                    ))}
                    ，请填写修订原因与操作人，原值与新值将一并留痕。
                  </span>
                }
              />
              <Space size={12} style={{ display: 'flex', marginTop: 12 }} align="start">
                <Form.Item
                  name="revisionReason"
                  label="修订原因"
                  style={{ flex: 1 }}
                  rules={[{ required: true, message: '与岩性编录重叠的回次必须填写修订原因' }]}
                >
                  <Input.TextArea rows={2} maxLength={120} placeholder="如：编录核对后修正岩芯长度" style={{ width: 380 }} />
                </Form.Item>
                <Form.Item
                  name="revisionOperator"
                  label="操作人"
                  rules={[{ required: true, message: '请填写操作人' }]}
                >
                  <Input style={{ width: 140 }} maxLength={16} placeholder="操作人" />
                </Form.Item>
              </Space>
            </>
          ) : null}

          <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} maxLength={60} placeholder="岩芯破碎情况等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(voidTarget)}
        title={voidTarget ? `作废回次 · ${voidTarget.runNo}` : '作废回次'}
        onCancel={() => setVoidTarget(null)}
        onOk={confirmVoid}
        okText="确认作废"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={560}
      >
        {voidTarget ? (
          <>
            <Alert
              type="warning"
              showIcon
              message="该回次与岩性编录深度重叠，作废需留痕"
              description={
                <span>
                  重叠编录段：
                  {(overlapMap.get(voidTarget.id) ?? []).map((log) => (
                    <Tag key={log.id} color="orange" style={{ marginLeft: 4 }}>
                      {log.lithology} {log.fromDepth}~{log.toDepth}m
                    </Tag>
                  ))}
                  。作废后回次不再参与采取率与连续性计算，原值、原因、时间与操作人将保留在修订留痕中。
                </span>
              }
            />
            <div style={{ marginTop: 12 }}>
              <Text strong>作废原因</Text>
              <Input.TextArea
                style={{ marginTop: 6 }}
                rows={3}
                maxLength={120}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="如：岩芯编录核对后确认该回次记录有误，予以作废"
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <Text strong>操作人</Text>
              <Input style={{ marginTop: 6, width: 200, display: 'block' }} maxLength={16} value={voidOperator} onChange={(e) => setVoidOperator(e.target.value)} placeholder="操作人" />
            </div>
          </>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(historyRun)}
        title={historyRun ? `回次留痕 · ${historyRun.runNo}（${historyRun.fromDepth}~${historyRun.toDepth}m）` : '回次留痕'}
        width={860}
        onClose={() => setHistoryRun(null)}
      >
        <RevisionTable revisions={historyRevisions} />
      </Drawer>

      <Drawer open={holeHistoryOpen} title="本孔回次修订留痕" width={860} onClose={() => setHoleHistoryOpen(false)}>
        <RevisionTable revisions={holeRevisions} />
      </Drawer>
    </div>
  );
}
