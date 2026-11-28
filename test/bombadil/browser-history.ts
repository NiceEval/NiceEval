export async function traverseViewHistory(navigation: Navigation, direction: "back" | "forward"): Promise<void> {
  const canTraverse = direction === "back" ? navigation.canGoBack : navigation.canGoForward;
  if (canTraverse) await navigation[direction]().finished;
}
