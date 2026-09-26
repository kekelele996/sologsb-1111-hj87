import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import RecoveryBadge from '../components/common/RecoveryBadge';
import DepthRangeInput from '../components/common/DepthRangeInput';
import EmptyPanel from '../components/common/EmptyPanel';
import { useDepthCalc } from '../hooks/useDepthCalc';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore, type RunOverlapInfo } from '../stores/runStore';
import { useLithoStore } from '../stores/lithoStore';
import { SHIFTS } from '../types/drill-hole';
import type { DrillRun, RunRevision, RunShift, RunStatus } from '../types/drill-run';
import { overlappingLithos, footageOf, recoveryOf, validateRange } from '../utils/recovery';

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
  revisionReason?: string;
  revisionOperator?: string;
}

interface VoidFormValues {
  reason?: string;
  operator: string;
}

type StatusFilter = '全部' | RunStatus;

/** 回次记录：起止深度自动算进尺与采取率；与岩性编录重叠的回次调整/作废需填原因并留痕 */
export default function RunLog() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const currentHoleId = useHoleStore((s) => s.currentHoleId);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const runs = useRunStore((s) => s.runs);
  const revisions = useRunStore((s) => s.revisions);
  const addRun = useRunStore((s) => s.addRun);
  const updateRun = useRunStore((s) => s.updateRun);
  const voidRun = useRunStore((s) => s.voidRun);
  const lithos = useLithoStore((s) => s.lithos);
  const { runsOf, summarize } = useDepthCalc();

  const [form] = Form.useForm<RunFormValues>();
  const [voidForm] = Form.useForm<VoidFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DrillRun | null>(null);
  /** 打开编辑时该回次（原深度区间）与岩性编录的重叠情况：非空时修订原因必填 */
  const [editOverlaps, setEditOverlaps] = useState<RunOverlapInfo[]>([]);
  const [voidTarget, setVoidTarget] = useState<DrillRun | null>(null);
  const [voidOverlaps, setVoidOverlaps] = useState<RunOverlapInfo[]>([]);
  const [historyRun, setHistoryRun] = useState<DrillRun | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('全部');
  /** 深度区间以本地 state 为唯一数据源：避免 Form.useWatch 在弹窗首次挂载前读不到值 */
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [liveCore, setLiveCore] = useState(0);

  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · ${hole.rigNo}`, value: hole.id }));
  const activeHoleId = currentHoleId || holes[0]?.id || '';
  const summary = useMemo(() => summarize(activeHoleId), [summarize, activeHoleId]);
  const holeAllRuns = useMemo(
    () => runs.filter((run) => run.holeId === activeHoleId).sort((a, b) => b.fromDepth - a.fromDepth),
    [runs, activeHoleId],
  );
  const tableRuns = useMemo(
    () => (statusFilter === '全部' ? holeAllRuns : holeAllRuns.filter((run) => (run.status ?? '正常') === statusFilter)),
    [holeAllRuns, statusFilter],
  );
  const historyRevisions = useMemo(
    () => (historyRun ? revisions.filter((rev) => rev.runId === historyRun.id) : []),
    [revisions, historyRun],
  );
  const formHoleId = Form.useWatch('holeId', form) ?? activeHoleId;

  const overlapInfoOf = (run: DrillRun): RunOverlapInfo[] =>
    overlappingLithos(run, lithos).map(({ log, overlapFrom, overlapTo }) => ({
      lithoId: log.id,
      lithology: log.lithology,
      fromDepth: log.fromDepth,
      toDepth: log.toDepth,
      overlapFrom,
      overlapTo,
    }));

  /**
   * 编辑弹窗中的实时重叠情况：以弹窗当前深度/钻孔与同孔岩性编录比对。
   * 改深度、切孔导致新重叠时立即提示必填原因；存储层再做一次兜底校验。
   */
  const liveOverlaps = useMemo<RunOverlapInfo[]>(() => {
    if (!editing || range.to <= range.from) return editOverlaps;
    return overlapInfoOf({
      id: editing.id,
      holeId: formHoleId,
      fromDepth: range.from,
      toDepth: range.to,
    } as DrillRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, formHoleId, range.from, range.to, lithos]);

  const openCreate = () => {
    setEditing(null);
    setEditOverlaps([]);
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
    setEditOverlaps(overlapInfoOf(record));
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
      revisionReason: '',
      revisionOperator: record.recorder,
    } as unknown as RunFormValues);
    setOpen(true);
  };

  const openVoid = (record: DrillRun) => {
    setVoidTarget(record);
    setVoidOverlaps(overlapInfoOf(record));
    voidForm.setFieldsValue({ reason: '', operator: record.recorder } as VoidFormValues);
  };

  const closeVoid = () => {
    setVoidTarget(null);
    setVoidOverlaps([]);
    voidForm.resetFields();
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
      const result = await updateRun(
        editing.id,
        payload,
        { reason: values.revisionReason, operator: values.revisionOperator ?? '' },
      );
      if (!result.ok) {
        if (result.reason === 'reason-required') {
          setEditOverlaps(result.overlaps);
          message.error('该回次已与岩性编录深度重叠，调整必须填写修订原因');
          form.validateFields(['revisionReason']).catch(() => undefined);
        } else if (result.reason === 'voided') {
          message.error('已作废回次不可调整');
        } else if (result.reason === 'unchanged') {
          message.info('内容未发生变化，无需修订');
          setOpen(false);
        } else if (result.reason === 'operator-required') {
          message.error('请填写修订操作人');
        }
        return;
      }
      message.success(
        result.revision.reason
          ? `已修订回次 ${result.run.runNo}，原因与 ${result.revision.changes.length} 项原值变化已留痕`
          : `已调整回次 ${result.run.runNo}，${result.revision.changes.length} 项变化已留痕`,
      );
    } else {
      await addRun(payload);
      message.success(`已录入回次 ${payload.runNo}，进尺 ${footage}m，采取率 ${recovery}%`);
    }
    setOpen(false);
  };

  const submitVoid = async () => {
    if (!voidTarget) return;
    const values = await voidForm.validateFields();
    const result = await voidRun(voidTarget.id, { reason: values.reason, operator: values.operator });
    if (!result.ok) {
      if (result.reason === 'reason-required') {
        setVoidOverlaps(result.overlaps);
        message.error('该回次已与岩性编录深度重叠，作废必须填写原因');
        voidForm.validateFields(['reason']).catch(() => undefined);
      } else if (result.reason === 'voided') {
        message.error('该回次已是作废状态');
      }
      return;
    }
    message.success(`已作废回次 ${voidTarget.runNo}，采取率、异常清单与岩芯箱连续性按修订后结果展示`);
    closeVoid();
  };

  const columns: TableColumnsType<DrillRun> = [
    {
      title: '回次号',
      dataIndex: 'runNo',
      width: 110,
      render: (v: string, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.2 }}>
          <Text strong delete={row.status === '作废'}>
            {v}
          </Text>
          {row.status === '作废' ? <Tag color="red">已作废</Tag> : null}
        </Space>
      ),
    },
    { title: '深度区间(m)', width: 140, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '进尺(m)', dataIndex: 'footage', width: 90, align: 'right' },
    { title: '岩芯长度(m)', dataIndex: 'coreLength', width: 110, align: 'right' },
    { title: '采取率', dataIndex: 'recovery', width: 140, render: (v: number) => <RecoveryBadge recovery={v} showAdvice /> },
    { title: '回次水位(m)', dataIndex: 'waterLevel', width: 110, align: 'right' },
    { title: '班次', dataIndex: 'shift', width: 70 },
    { title: '钻进日期', dataIndex: 'drilledAt', width: 110, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '记录人', dataIndex: 'recorder', width: 90 },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v?: string) => v ?? '-' },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, record) => {
        const count = revisions.filter((rev) => rev.runId === record.id).length;
        return (
          <Space size={2}>
            <Button size="small" type="link" disabled={record.status === '作废'} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Button size="small" type="link" onClick={() => setHistoryRun(record)}>
              留痕{count ? `(${count})` : ''}
            </Button>
            {record.status !== '作废' ? (
              <Button size="small" type="link" danger onClick={() => openVoid(record)}>
                作废
              </Button>
            ) : null}
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
        起止深度与岩芯长度自动计算进尺与采取率；已与岩性编录深度重叠的回次，调整或作废必须填写原因，原值、修改后的值、时间与操作人逐条留痕，未重叠回次可直接调整。采取率、工作台异常清单与岩芯箱连续性均按修订后的有效回次展示。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>当前钻孔</span>
        <Select style={{ width: 200 }} value={activeHoleId} onChange={setCurrentHole} options={holeOptions} placeholder="选择钻孔" />
        <Button type="primary" onClick={openCreate} disabled={!activeHoleId}>
          录入回次
        </Button>
        <Segmented
          size="small"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
          options={[
            { label: `全部 ${holeAllRuns.length}`, value: '全部' },
            { label: `正常 ${summary.runCount}`, value: '正常' },
            { label: `作废 ${summary.voidedCount}`, value: '作废' },
          ]}
        />
        <Text type="secondary">
          深度覆盖：{summary.coverage.length ? summary.coverage.map((r) => `${r.from}~${r.to}m`).join('、') : '尚无有效回次'}
        </Text>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="有效回次" value={summary.runCount} unit="个" />
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

      {holeAllRuns.length === 0 ? (
        <EmptyPanel description="该孔暂无回次记录" actionText="录入回次" onAction={openCreate} />
      ) : (
        <Card size="small">
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={tableRuns}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1400 }}
            rowClassName={(row) => (row.status === '作废' ? 'voided-row' : '')}
          />
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
              referenceRuns={runsOf(formHoleId)}
              ignoreRunId={editing?.id}
              maxDepth={holes.find((h) => h.id === formHoleId)?.designDepth}
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

          {editing ? (
            <Card
              size="small"
              style={{ marginTop: 12 }}
              title={<Text strong>修订留痕</Text>}
              extra={<Tag color={liveOverlaps.length ? 'red' : 'blue'}>{liveOverlaps.length ? '与岩性编录重叠' : '无岩性重叠'}</Tag>}
            >
              {liveOverlaps.length > 0 ? (
                <Alert
                  style={{ marginBottom: 10 }}
                  type="warning"
                  showIcon
                  message={`该回次深度区间已与 ${liveOverlaps.length} 段岩性编录重叠，调整必须填写修订原因`}
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {liveOverlaps.map((item) => (
                        <li key={item.lithoId}>
                          {item.lithology} {item.fromDepth}~{item.toDepth}m · 重叠 {item.overlapFrom}~{item.overlapTo}m
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : (
                <Alert style={{ marginBottom: 10 }} type="info" showIcon message="该回次未与岩性编录深度重叠，可直接调整；保存后仍会把每次变化记入回次台账。" />
              )}
              <Space size={12} style={{ display: 'flex' }} align="start">
                <Form.Item
                  name="revisionOperator"
                  label="修订操作人"
                  rules={[{ required: true, message: '请填写修订操作人' }]}
                  style={{ flex: '0 0 200px' }}
                >
                  <Input maxLength={16} placeholder="操作人" />
                </Form.Item>
                <Form.Item
                  name="revisionReason"
                  label="修订原因"
                  style={{ flex: 1, minWidth: 320 }}
                  rules={liveOverlaps.length ? [{ required: true, message: '该回次已与岩性编录重叠，必须填写修订原因' }] : []}
                  extra={liveOverlaps.length ? undefined : '未重叠回次原因选填'}
                >
                  <Input maxLength={100} placeholder={liveOverlaps.length ? '如：现场复测校正深度 / 岩芯长度核错' : '选填，便于追溯'} />
                </Form.Item>
              </Space>
            </Card>
          ) : null}

          <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} maxLength={60} placeholder="岩芯破碎情况等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={voidTarget !== null}
        title={`作废回次 · ${voidTarget?.runNo ?? ''}`}
        onCancel={closeVoid}
        onOk={submitVoid}
        okText="确认作废"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        width={560}
      >
        {voidTarget ? (
          <Form form={voidForm} layout="vertical">
            <Descriptions size="small" column={2} style={{ marginBottom: 8 }}>
              <Descriptions.Item label="深度区间">{`${voidTarget.fromDepth}~${voidTarget.toDepth}m`}</Descriptions.Item>
              <Descriptions.Item label="采取率">{voidTarget.recovery}%</Descriptions.Item>
            </Descriptions>
            <Alert
              style={{ marginBottom: 10 }}
              type={voidOverlaps.length ? 'warning' : 'info'}
              showIcon
              message={
                voidOverlaps.length
                  ? `该回次已与 ${voidOverlaps.length} 段岩性编录深度重叠，作废必须填写原因`
                  : '作废后该回次不再参与采取率、工作台异常清单与岩芯箱连续性计算，但仍保留在回次台账中。'
              }
              description={
                voidOverlaps.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {voidOverlaps.map((item) => (
                      <li key={item.lithoId}>
                        {item.lithology} {item.fromDepth}~{item.toDepth}m · 重叠 {item.overlapFrom}~{item.overlapTo}m
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
            <Form.Item name="operator" label="作废操作人" rules={[{ required: true, message: '请填写作废操作人' }]}>
              <Input maxLength={16} placeholder="操作人" />
            </Form.Item>
            <Form.Item
              name="reason"
              label="作废原因"
              rules={voidOverlaps.length ? [{ required: true, message: '该回次已与岩性编录重叠，必须填写作废原因' }] : []}
              extra={voidOverlaps.length ? undefined : '未重叠回次原因选填'}
            >
              <Input.TextArea rows={2} maxLength={100} placeholder={voidOverlaps.length ? '如：回次重复登记，经编录复核作废' : '选填，便于追溯'} />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>

      <Drawer
        open={historyRun !== null}
        title={`修订留痕 · ${historyRun?.runNo ?? ''}`}
        width={620}
        onClose={() => setHistoryRun(null)}
      >
        {historyRun ? (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="深度区间">{`${historyRun.fromDepth}~${historyRun.toDepth}m`}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {historyRun.status === '作废' ? <Tag color="red">已作废</Tag> : <Tag color="green">正常</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="当前采取率">{historyRun.recovery}%</Descriptions.Item>
              <Descriptions.Item label="记录人">{historyRun.recorder}</Descriptions.Item>
            </Descriptions>
            {historyRevisions.length === 0 ? (
              <Alert type="info" showIcon message="该回次尚无修订记录，保存后的值即原始录入值。" />
            ) : (
              <Timeline
                items={historyRevisions.map((rev) => ({
                  color: rev.action === '作废' ? 'red' : 'blue',
                  children: <RevisionDetail key={rev.id} revision={rev} holeNoOf={(id) => holes.find((h) => h.id === id)?.holeNo ?? id} />,
                }))}
              />
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

/** 单条留痕：动作、时间、操作人、原因与逐字段原值 → 新值 */
function RevisionDetail({ revision, holeNoOf }: { revision: RunRevision; holeNoOf: (holeId: string) => string }) {
  const formatValue = (field: RunRevision['changes'][number]['field'], value: string | number | null): string => {
    if (value === null) return '（空）';
    if (field === 'drilledAt') return dayjs(value).format('YYYY-MM-DD');
    if (field === 'holeId') return holeNoOf(String(value));
    return String(value);
  };
  return (
    <div>
      <Space size={8} wrap>
        <Tag color={revision.action === '作废' ? 'red' : 'blue'}>{revision.action}</Tag>
        <Text strong>{dayjs(revision.revisedAt).format('YYYY-MM-DD HH:mm')}</Text>
        <Text type="secondary">操作人：{revision.operator}</Text>
      </Space>
      <div style={{ marginTop: 4 }}>
        <Text type="secondary">原因：</Text>
        {revision.reason ? <Text>{revision.reason}</Text> : <Tag>未重叠，免填原因</Tag>}
      </div>
      <div style={{ marginTop: 6 }}>
        {revision.changes.map((change) => (
          <div key={change.field} style={{ fontSize: 13, lineHeight: 1.9 }}>
            <Tag>{change.label}</Tag>
            <Text delete type="secondary">
              {formatValue(change.field, change.before)}
            </Text>
            <span style={{ margin: '0 6px', color: '#6b7a86' }}>→</span>
            <Text strong>{formatValue(change.field, change.after)}</Text>
          </div>
        ))}
      </div>
    </div>
  );
}
