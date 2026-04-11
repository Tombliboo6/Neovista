import { useEffect, useState } from 'react';
import { X, CreditCard } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import BillingHistoryPanel from './BillingHistoryPanel';

export default function RedeemModal({ isOpen, onClose }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const redeemCode = useAppStore((s) => s.redeemCode);
  const refreshBilling = useAppStore((s) => s.refreshBilling);
  const billingSummary = useAppStore((s) => s.billingSummary);
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccess('');
    refreshBilling().catch(() => null);
  }, [isOpen, refreshBilling]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!code.trim()) {
      setError('请输入兑换码');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const data = await redeemCode(code.trim());
      setSuccess(`充值成功，当前余额 ${data.credits} 点`);
      setCode('');
    } catch (e) {
      setError(e.message || '兑换失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-surface-0 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 hover:bg-white/10 transition">
          <X size={16} className="text-white/50" />
        </button>

        <div className="grid gap-5 md:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-brand-gold/10 p-2">
                <CreditCard size={18} className="text-brand-gold" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">兑换充值</h3>
                <p className="text-sm text-white/50">输入兑换码，算力点即时到账</p>
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs text-white/45">当前余额</div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {billingSummary?.credits ?? user?.credits ?? 0}
                  <span className="ml-1 text-sm font-normal text-white/45">点</span>
                </div>
              </div>
              <div className="rounded-xl border border-brand-gold/20 bg-brand-gold/5 p-4">
                <div className="text-xs text-white/45">充值说明</div>
                <div className="mt-2 text-sm leading-6 text-white/75">
                  先联系主理人微信购买兑换码，再回到这里输入即可到账。MVP 阶段不接第三方支付，账单全走兑换码流水。
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-white/60">兑换码</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="例如 NV-A8F9-2B4C"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-brand-gold/50"
                />
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-6 text-white/55">
                添加主理人微信，人工充值 / 购买兑换码。你收到兑换码后，直接在这里输入即可到账。
              </div>

              {error ? <div className="text-sm text-red-400">{error}</div> : null}
              {success ? <div className="text-sm text-green-400">{success}</div> : null}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 transition"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 rounded-xl bg-brand-gold px-4 py-2 text-sm font-medium text-surface-0 hover:opacity-90 disabled:opacity-50 transition"
                >
                  {loading ? '兑换中...' : '确认兑换'}
                </button>
              </div>
            </div>
          </div>

          <div>
            <BillingHistoryPanel transactions={billingSummary?.transactions || []} />
          </div>
        </div>
      </div>
    </div>
  );
}
