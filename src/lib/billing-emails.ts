export type BillingEmail = { subject: string; html: string };

export function buildPaymentFailedEmail(loginUrl: string): BillingEmail {
  return {
    subject: "Your Voicer payment didn't go through — 24 hours on us",
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:48px 24px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Voicer</p>
        </td></tr>
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#a1a1aa;">
            Your card didn&rsquo;t go through on this billing cycle.<br><br>
            <strong>You&rsquo;ve got the next 24 hours on us</strong> &mdash; keep voice coding
            without interruption. Just update your payment method before then and everything stays
            exactly as it is.<br><br>
            If the card still fails after 24 hours, your subscription will cancel automatically.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <a href="${loginUrl}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Update payment method &rarr;
          </a>
        </td></tr>
        <tr><td style="border-top:1px solid #27272a;padding-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
            Questions? Just reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export function buildSubscriptionCanceledEmail(loginUrl: string): BillingEmail {
  return {
    subject: "Your Voicer subscription was canceled — 7 days to reactivate",
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:48px 24px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;">Voicer</p>
        </td></tr>
        <tr><td style="padding-bottom:20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#a1a1aa;">
            We tried your card again and it still didn&rsquo;t go through, so your Voicer
            subscription has been canceled.<br><br>
            <strong>Your account and settings are safe for the next 7 days.</strong>
            Reactivate any time in that window and you pick up exactly where you left off
            &mdash; same devices, same preferences, nothing lost.<br><br>
            After 7 days we start cleaning up inactive data.
          </p>
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <a href="${loginUrl}"
             style="display:inline-block;background:#ffffff;color:#000000;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">
            Reactivate subscription &rarr;
          </a>
        </td></tr>
        <tr><td style="border-top:1px solid #27272a;padding-top:24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
            Changed your mind about Voicer? We&rsquo;d love to hear why &mdash; just reply.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
