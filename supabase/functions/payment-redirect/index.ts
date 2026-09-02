Deno.serve((req) => {
  const url = new URL(req.url);
  const isSuccess = url.searchParams.get("status") !== "failed";

  const emoji = isSuccess ? "✓" : "✕";
  const color = isSuccess ? "#2DAA6E" : "#E85D4D";
  const title = isSuccess ? "Payment received" : "Payment not completed";
  const subtitle = isSuccess
    ? "You can close this window and return to VendorDash."
    : "You can close this window and try again in the app.";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #F5F5F5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #FFFFFF; border-radius: 16px; padding: 36px 28px; text-align: center; max-width: 320px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .icon { width: 56px; height: 56px; border-radius: 28px; background: ${color}; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #fff; font-size: 26px; font-weight: 600; }
  h1 { font-size: 17px; margin: 0 0 6px; color: #1A1A1A; }
  p { font-size: 13px; color: #8A8A8A; margin: 0; line-height: 1.4; }
</style>
</head>
<body>
<div class="card">
<div class="icon">${emoji}</div>
<h1>${title}</h1>
<p>${subtitle}</p>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
