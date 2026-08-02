/**
 * Model-facing output caps, declared per capability via
 * `meta.agent.redact.output` and applied ONLY on model surfaces (aiSdk/mcp).
 *
 * The UI reads through plain oRPC, which never redacts, so screens keep the
 * full data. Without this an unfiltered ledger read goes straight into the
 * next step's prompt, and the model pays for every row it will not use — the
 * failure mode is a turn that costs six figures of input tokens to answer a
 * question about three invoices.
 */

export function capRows(max: number) {
  return (output: unknown): unknown => {
    if (!Array.isArray(output)) return output;
    if (output.length <= max) return output;
    return {
      rows: output.slice(0, max),
      totalRows: output.length,
      truncatedForModel: true,
    };
  };
}
