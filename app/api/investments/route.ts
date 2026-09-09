export async function GET() {
  return Response.json({
    error: "Раздел общих финансовых идей отключён. PricePulse показывает только справочную аналитику рынка виртуальных предметов CS2.",
    code: "feature_disabled",
  }, { status: 410, headers: { "cache-control": "no-store" } });
}