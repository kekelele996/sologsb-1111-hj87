import { Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { RunRevision, RunSnapshot } from '../../types/run-revision';

const { Text } = Typography;

/** 快照摘要：深度区间 · 岩芯长度 · 采取率 */
function snapshotText(snapshot: RunSnapshot): string {
  return `${snapshot.fromDepth}~${snapshot.toDepth}m · 岩芯 ${snapshot.coreLength}m · 采取率 ${snapshot.recovery}%`;
}

/** 回次修订留痕列表：原值 / 修订后 / 原因 / 时间 / 操作人 */
export default function RevisionTable({ revisions }: { revisions: RunRevision[] }) {
  const columns: TableColumnsType<RunRevision> = [
    {
      title: '修订时间',
      dataIndex: 'revisedAt',
      width: 150,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    { title: '回次号', width: 100, render: (_, row) => <Text strong>{row.before.runNo}</Text> },
    {
      title: '动作',
      dataIndex: 'action',
      width: 80,
      render: (v: RunRevision['action']) => <Tag color={v === '作废' ? 'red' : 'blue'}>{v}</Tag>,
    },
    {
      title: '原值',
      width: 220,
      render: (_, row) => <Text type="secondary">{snapshotText(row.before)}</Text>,
    },
    {
      title: '修订后',
      width: 220,
      render: (_, row) => (row.after ? snapshotText(row.after) : <Text type="danger">已作废</Text>),
    },
    { title: '修订原因', dataIndex: 'reason', ellipsis: true },
    { title: '操作人', dataIndex: 'operator', width: 90 },
  ];

  return (
    <Table
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={revisions}
      pagination={{ pageSize: 8, hideOnSinglePage: true }}
      scroll={{ x: 1000 }}
      locale={{ emptyText: '暂无修订留痕' }}
    />
  );
}
