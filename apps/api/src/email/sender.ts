export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Brevo transactional email API. */
export function createBrevoSender(opts: {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(m) {
      const res = await doFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': opts.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: opts.fromAddress, name: opts.fromName },
          to: [{ email: m.to }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
        }),
      });
      if (!res.ok) {
        // Never include the request (it holds the invite link) in the error.
        throw new Error(`Brevo send failed with status ${res.status}`);
      }
    },
  };
}

/** Used when no API key is configured: records that a mail would have been sent. */
export function createLogSender(log: (msg: string) => void): EmailSender {
  return {
    async send(m) {
      log(`[email disabled] would send "${m.subject}" to ${m.to}`);
    },
  };
}
