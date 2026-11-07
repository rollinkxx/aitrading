export type SignalOutcomeRow = {
  signal_id: string;
  exit_price: number;
  return_percentage: number;
  outcome: string;
  closed_at: string;
};

/**
 * Persist outcomes before closing signals. The persistence callback must use a
 * unique constraint on signal_id with conflict-ignore semantics so concurrent
 * checker/collector runs converge on one outcome per signal.
 */
export async function persistSignalOutcomes(
  rows: SignalOutcomeRow[],
  insertOutcomes: (uniqueRows: SignalOutcomeRow[]) => Promise<unknown>,
  closeActiveSignals: (signalIds: string[]) => Promise<unknown>,
): Promise<number> {
  const uniqueRows = [...new Map(rows.filter(row => row.signal_id).map(row => [row.signal_id, row])).values()];
  if (uniqueRows.length === 0) return 0;

  await insertOutcomes(uniqueRows);
  await closeActiveSignals(uniqueRows.map(row => row.signal_id));
  return uniqueRows.length;
}
