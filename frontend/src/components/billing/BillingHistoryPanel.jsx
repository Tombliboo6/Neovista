const TYPE_LABELS = {
  WELCOME_GRANT: '注册赠送',
  REDEEM: '兑换码充值',
  GENERATE_HOLD: '生图预扣',
  GENERATE_CAPTURE: '生图确认',
  GENERATE_REFUND: '失败退款',
  ADMIN_ADJUST: '人工调账',
};

const STATUS_LABELS = {
  PENDING: '处理中',
  SUCCESS: '成功',
  REFUNDED: '已退款',
  FAILED: '失败',
};

function formatAmount(amount) {
  if (amount > 0) return `+${amount}`;
  return `${amount}`;
}

function formatTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BillingHistoryPanel({ transactions = [] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-white">最近账单</h4>
          <p className="text-xs text-white/45">展示最近 20 条算力点流水</p>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/40">
          暂无账单记录，首次注册会自动发放新手算力点。
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <div
              key={tx.transaction_id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/6 bg-black/10 px-3 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-white">
                  {TYPE_LABELS[tx.type] || tx.type}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
                  <span>{formatTime(tx.created_at)}</span>
                  <span>{STATUS_LABELS[tx.status] || tx.status}</span>
                  <span>余额 {tx.balance_after ?? '--'} 点</span>
                </div>
              </div>
              <div className={`shrink-0 text-sm font-medium ${tx.amount >= 0 ? 'text-green-400' : 'text-amber-300'}`}>
                {formatAmount(tx.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
