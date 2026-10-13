const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inviteEmail(opts: {
  orgName: string;
  inviterName: string;
  link: string;
  expiresInDays: number;
}) {
  const subject = `${opts.inviterName} invited you to ${opts.orgName} on Crew Deck`;
  const text = `${opts.inviterName} invited you to join ${opts.orgName}.\n\nAccept the invitation: ${opts.link}\n\nThis link expires in ${opts.expiresInDays} days.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1f2430">
  <h2 style="margin:0 0 12px">You're invited to ${esc(opts.orgName)}</h2>
  <p>${esc(opts.inviterName)} invited you to join the <strong>${esc(opts.orgName)}</strong> workspace.</p>
  <p style="margin:24px 0"><a href="${esc(opts.link)}" style="background:#2f7bff;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Accept invitation</a></p>
  <p style="color:#6b7280;font-size:13px">This link expires in ${opts.expiresInDays} days. If you weren't expecting it, you can ignore this email.</p>
</div>`;
  return { subject, text, html };
}
