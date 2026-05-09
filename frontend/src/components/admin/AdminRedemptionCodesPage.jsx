import { useMemo, useState } from 'react';
import { Check, Copy, Loader2, Ticket } from 'lucide-react';

const CREDITS_PER_YUAN = 100;
const amountPresets = [5, 10, 20, 50];

function buildDefaultBatch(amountYuan) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `wechat-${year}-${month}-${amountYuan}yuan`;
}

export default function AdminRedemptionCodesPage() {
  const [amountYuan, setAmountYuan] = useState(10);
  const [credits, setCredits] = useState(10 * CREDITS_PER_YUAN);
  const [count, setCount] = useState(1);
  const [batch, setBatch] = useState(buildDefaultBatch(10));
  const [expiresDays, setExpiresDays] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalCredits = useMemo(() => credits * count, [credits, count]);

  const applyAmountPreset = (nextAmount) => {
    setAmountYuan(nextAmount);
    setCredits(nextAmount * CREDITS_PER_YUAN);
    setBatch(buildDefaultBatch(nextAmount));
  };

  const handleCreditsChange = (event) => {
    const nextCredits = Number(event.target.value);
    setCredits(nextCredits);
    setAmountYuan(Number((nextCredits / CREDITS_PER_YUAN).toFixed(2)));
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    const adminToken = localStorage.getItem('adminToken');
    if (!adminToken) {
      window.location.reload();
      return;
    }

    setLoading(true);
    setError('');
    setCopied(false);

    try {
      const response = await fetch('/api/v1/billing/admin/redemption-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({
          credits: Number(credits),
          count: Number(count),
          batch: batch.trim() || null,
          expires_days: expiresDays ? Number(expiresDays) : null,
        }),
      });

      if (response.status === 403) {
        localStorage.removeItem('adminToken');
        window.location.reload();
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || `生成失败: ${response.status}`);
      }

      setGeneratedCodes(data.codes || []);
    } catch (generateError) {
      setError(generateError.message || '生成兑换码失败');
      setGeneratedCodes([]);
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = async () => {
    if (generatedCodes.length === 0) {
      return;
    }

    await navigator.clipboard.writeText(generatedCodes.join('\n'));
    setCopied(true);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-slate-900 px-6 py-7 text-white">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">Redemption Codes</p>
            <h3 className="mt-2 text-3xl font-semibold">生成兑换码</h3>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 text-right">
            <p className="text-xs text-slate-300">本批次总点数</p>
            <p className="mt-1 text-3xl font-semibold">{Number.isFinite(totalCredits) ? totalCredits : 0}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.55fr)]">
        <form onSubmit={handleGenerate} className="space-y-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <div>
            <label className="block text-sm font-medium text-slate-700">充值金额</label>
            <div className="mt-3 flex flex-wrap gap-2">
              {amountPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyAmountPreset(preset)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    amountYuan === preset
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {preset} 元
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">单码点数</span>
              <input
                type="number"
                min="1"
                value={credits}
                onChange={handleCreditsChange}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">生成数量</span>
              <input
                type="number"
                min="1"
                max="200"
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">批次</span>
              <input
                type="text"
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">有效期天数</span>
              <input
                type="number"
                min="1"
                max="365"
                value={expiresDays}
                onChange={(event) => setExpiresDays(event.target.value)}
                placeholder="不过期"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900"
              />
            </label>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Ticket size={16} />}
            生成兑换码
          </button>
        </form>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Generated</p>
              <h4 className="mt-2 text-xl font-semibold text-slate-900">兑换码</h4>
            </div>
            <button
              type="button"
              onClick={copyCodes}
              disabled={generatedCodes.length === 0}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          <div className="mt-5 min-h-52 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
            {generatedCodes.length > 0 ? (
              <div className="space-y-2">
                {generatedCodes.map((code) => (
                  <div key={code} className="rounded-2xl bg-white px-4 py-3 font-mono text-sm font-semibold text-slate-900">
                    {code}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-44 items-center justify-center text-sm text-slate-400">
                暂无兑换码
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
