import { groupStageFeedback } from './stage-feedback';

export function StageFeedback({ messages }: { messages: string | string[] | undefined }) {
  const { actionable, optional } = groupStageFeedback(messages);
  if (!actionable.length && !optional.length) return null;
  return <div className="stage-feedback">
    {!!actionable.length && <div className="agent-warning stage-feedback-actionable">
      <strong>请检查以下内容</strong>
      <span>{actionable[0]}</span>
      {actionable.length > 1 && <details><summary>其余 {actionable.length - 1} 项</summary><ul>{actionable.slice(1).map(message => <li key={message}>{message}</li>)}</ul></details>}
    </div>}
    {!!optional.length && <details className="stage-feedback-optional"><summary>查看建议</summary><ul>{optional.map(message => <li key={message}>{message}</li>)}</ul></details>}
  </div>;
}
