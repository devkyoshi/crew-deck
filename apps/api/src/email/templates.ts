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

export function verifySignupEmail(opts: { company: string; link: string; expiresInHours: number }) {
  const subject = `Confirm your email to create ${opts.company} on Crew Deck`;
  const text = `Confirm your email to finish creating the ${opts.company} workspace.\n\nCreate the workspace: ${opts.link}\n\nThis link expires in ${opts.expiresInHours} hours. If you did not ask for this, you can ignore this email.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1f2430">
  <h2 style="margin:0 0 12px">Finish creating ${esc(opts.company)}</h2>
  <p>Confirm your email address to create the <strong>${esc(opts.company)}</strong> workspace on Crew Deck.</p>
  <p style="margin:24px 0"><a href="${esc(opts.link)}" style="background:#2f7bff;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Create my workspace</a></p>
  <p style="color:#6b7280;font-size:13px">This link expires in ${opts.expiresInHours} hours. If you did not ask for this, you can ignore this email.</p>
</div>`;
  return { subject, text, html };
}
