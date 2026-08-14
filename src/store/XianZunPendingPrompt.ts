let pendingPrompt = ''

export function setPendingXianZunPrompt(prompt: string): void {
  pendingPrompt = prompt
}

export function consumePendingXianZunPrompt(): string {
  const value = pendingPrompt
  pendingPrompt = ''
  return value
}
