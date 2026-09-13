/** Replace `{{token}}` placeholders. Unknown tokens are left in place so a bad template is visible. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
}
