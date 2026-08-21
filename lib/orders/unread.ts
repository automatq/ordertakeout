/** Clear only alerts visible under the active staff location filter. */
export function dismissVisibleUnread(
  unreadIds: ReadonlySet<string>,
  visibleIds: Iterable<string>,
): Set<string> {
  const next = new Set(unreadIds);
  for (const id of visibleIds) next.delete(id);
  return next;
}
