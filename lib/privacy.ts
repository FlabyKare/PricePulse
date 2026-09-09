export function containsSensitiveIdentifier(value: string) {
  const text = value.trim();
  const digits = text.replace(/\D/g, "");
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/.test(text)
    || /\b\d{3}[- ]?\d{3}[- ]?\d{3}[- ]?\d{2}\b/.test(text)
    || /\b(?:\d[ -]*?){16}\b/.test(text)
    || /(?:паспорт|снилс|инн|карта|cvv|cvc)\s*[:№]?\s*\d{4,}/i.test(text)
    || (digits.length >= 18 && /(?:паспорт|карта|сч[её]т)/i.test(text));
}