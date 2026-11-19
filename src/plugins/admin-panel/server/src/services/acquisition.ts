import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const validToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
export const cleanTag = (value: unknown, fallback = 'directo') =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : fallback;
export const isAutomated = (ua: string, purpose = '') =>
  /bot|crawler|spider|preview|headless|safelinks|proofpoint|barracuda|mimecast|curl|wget/i.test(
    ua
  ) || /prefetch|preview/i.test(purpose);

export async function ensureAcquisition(db: any) {
  await db.raw(`CREATE SCHEMA IF NOT EXISTS marketing;
    CREATE TABLE IF NOT EXISTS marketing.links (
      id uuid PRIMARY KEY, token_hash char(64) UNIQUE NOT NULL,
      campaign varchar(120) NOT NULL, channel varchar(32) NOT NULL,
      recipient varchar(320) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days')
    );
    CREATE TABLE IF NOT EXISTS marketing.clicks (
      id uuid PRIMARY KEY, link_id uuid REFERENCES marketing.links(id) ON DELETE SET NULL,
      campaign varchar(120) NOT NULL, channel varchar(32) NOT NULL,
      destination varchar(32) NOT NULL, automated boolean NOT NULL,
      receipt_hash char(64),
      clicked_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE marketing.clicks ADD COLUMN IF NOT EXISTS receipt_hash char(64);
    CREATE UNIQUE INDEX IF NOT EXISTS marketing_clicks_receipt ON marketing.clicks(receipt_hash);
    CREATE TABLE IF NOT EXISTS marketing.installs (
      click_id uuid PRIMARY KEY REFERENCES marketing.clicks(id) ON DELETE CASCADE,
      installed_at timestamptz NOT NULL, reported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS marketing_clicks_campaign_time ON marketing.clicks(campaign, clicked_at);
    CREATE INDEX IF NOT EXISTS marketing_clicks_link ON marketing.clicks(link_id);
    CREATE INDEX IF NOT EXISTS marketing_links_recipient ON marketing.links(recipient);`);
}

/** Personaliza enlaces del dominio propio; jamás pone email ni IDs de usuario en la URL. */
export async function personalizeStoreLinks(
  db: any,
  html: string,
  text: string | undefined,
  email: string,
  appUrl: string
) {
  const origin = new URL(appUrl).origin;
  const links = new Map<string, string>();
  const candidates = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) =>
    m[1].replace(/&amp;/g, '&')
  );
  if (text) candidates.push(...(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
  for (const raw of candidates) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin || !/^\/ir\/(app-store|play-store|microsoft-store)$/.test(u.pathname))
      continue;
    if (links.has(raw)) continue;
    const token = randomBytes(32).toString('hex');
    await db('marketing.links').insert({
      id: randomUUID(),
      token_hash: tokenHash(token),
      campaign: cleanTag(u.searchParams.get('c')),
      channel: 'email',
      recipient: email.trim().toLowerCase(),
    });
    u.search = new URLSearchParams({ t: token }).toString();
    links.set(raw, u.toString());
  }
  for (const [raw, url] of links) {
    html = html.split(raw.replace(/&/g, '&amp;')).join(url).split(raw).join(url);
    if (text) text = text.split(raw).join(url);
  }
  return { html, text };
}

export async function recordClick(db: any, input: any) {
  const destination = input.destination;
  if (!['app-store', 'play-store', 'microsoft-store'].includes(destination))
    throw new Error('invalid destination');
  let link: any = null;
  if (input.token) {
    if (!validToken(input.token)) throw new Error('invalid token');
    link = await db('marketing.links')
      .where({ token_hash: tokenHash(input.token) })
      .where('expires_at', '>', new Date())
      .first();
    if (!link) throw new Error('expired or unknown token');
  }
  const campaign = link?.campaign ?? cleanTag(input.campaign);
  const channel = link?.channel ?? cleanTag(input.channel, 'social').slice(0, 32);
  const id = randomUUID();
  const receipt = randomBytes(32).toString('hex');
  const automated = isAutomated(
    String(input.userAgent ?? '').slice(0, 500),
    String(input.purpose ?? '').slice(0, 80)
  );
  await db('marketing.clicks').insert({
    id,
    link_id: link?.id ?? null,
    campaign,
    channel,
    destination,
    automated,
    receipt_hash: tokenHash(receipt),
  });
  return { campaign, channel, recorded: true, automated, receipt: automated ? null : receipt };
}

export async function acquisitionReport(db: any, days: number) {
  // Aggregate the entire period, never the 200-row display sample.
  const summary = (
    await db.raw(
      `SELECT c.campaign, c.channel, c.destination,
    count(*) FILTER (WHERE NOT c.automated)::int AS clicks,
    count(*) FILTER (WHERE c.automated)::int AS automated,
    count(DISTINCT l.recipient) FILTER (WHERE NOT c.automated)::int AS recipients,
    count(*) FILTER (WHERE NOT c.automated AND c.link_id IS NULL)::int AS anonymous
    FROM marketing.clicks c LEFT JOIN marketing.links l ON l.id=c.link_id
    WHERE c.clicked_at >= now() - (? * interval '1 day') GROUP BY 1,2,3 ORDER BY 1,2,3`,
      [days]
    )
  ).rows;
  const installs = (
    await db.raw(
      `SELECT c.campaign,c.destination,count(*)::int AS installs
    FROM marketing.installs i JOIN marketing.clicks c ON c.id=i.click_id
    WHERE NOT c.automated AND c.clicked_at >= now() - (? * interval '1 day') GROUP BY 1,2`,
      [days]
    )
  ).rows;
  const installedPeople = (
    await db.raw(
      `SELECT l.recipient,c.campaign,c.destination,min(i.installed_at) AS installed_at
    FROM marketing.installs i JOIN marketing.clicks c ON c.id=i.click_id JOIN marketing.links l ON l.id=c.link_id
    WHERE NOT c.automated AND c.clicked_at >= now() - (? * interval '1 day') GROUP BY 1,2,3`,
      [days]
    )
  ).rows;
  const totals = (
    await db.raw(
      `SELECT count(*) FILTER (WHERE NOT c.automated)::int AS clicks,
    count(*) FILTER (WHERE c.automated)::int AS automated,
    count(DISTINCT l.recipient) FILTER (WHERE NOT c.automated)::int AS recipients
    FROM marketing.clicks c LEFT JOIN marketing.links l ON l.id=c.link_id
    WHERE c.clicked_at >= now() - (? * interval '1 day')`,
      [days]
    )
  ).rows[0];
  // Group recipient+campaign+destination before matching native activity.
  const people = (
    await db.raw(
      `SELECT l.recipient, c.campaign, c.destination,
    min(c.clicked_at) AS first_click, max(c.clicked_at) AS last_click, count(*)::int AS clicks
    FROM marketing.clicks c JOIN marketing.links l ON l.id=c.link_id
    WHERE NOT c.automated AND c.clicked_at >= now() - (? * interval '1 day')
    GROUP BY 1,2,3 ORDER BY last_click DESC LIMIT 200`,
      [days]
    )
  ).rows;
  let usageAvailable = true;
  let uses: any[] = [];
  if (people.length) {
    try {
      uses = (
        await db.raw(
          `WITH clicked AS (
        SELECT l.recipient, c.campaign, c.destination, min(c.clicked_at) AS first_click
        FROM marketing.clicks c JOIN marketing.links l ON l.id=c.link_id
        WHERE NOT c.automated AND c.clicked_at >= now() - (? * interval '1 day') GROUP BY 1,2,3
      ) SELECT c.recipient,c.campaign,c.destination,
        min(e.event_timestamp) FILTER (WHERE e.event_timestamp >= c.first_click
          AND e.event_timestamp <= c.first_click + interval '30 days') AS native_after,
        min(e.event_timestamp) AS first_native_observed
      FROM clicked c JOIN up_users u ON lower(trim(u.email))=c.recipient
      JOIN analytics.events e ON e.user_id=u.id
        AND e.device_context->>'plataforma'=CASE c.destination WHEN 'app-store' THEN 'ios-nativa' WHEN 'play-store' THEN 'android-nativa' ELSE 'unsupported' END
        AND e.event_name IN ('auth_login_ok','session_start','page_view','case_open')
        AND e.event_timestamp <= now()
      GROUP BY 1,2,3`,
          [days]
        )
      ).rows;
    } catch {
      usageAvailable = false;
    }
  }
  return {
    days,
    summary,
    totals,
    usageAvailable,
    people: people.map((person: any) => ({
      ...person,
      installed_at:
        installedPeople.find(
          (i: any) =>
            i.recipient === person.recipient &&
            i.campaign === person.campaign &&
            i.destination === person.destination
        )?.installed_at ?? null,
      ...(uses.find(
        (u) =>
          u.recipient === person.recipient &&
          u.campaign === person.campaign &&
          u.destination === person.destination
      ) ?? {}),
    })),
    nativeRecipients: usageAvailable
      ? new Set(uses.filter((u) => u.native_after).map((u) => u.recipient)).size
      : null,
    androidInstalls: installs.reduce((n: number, i: any) => n + i.installs, 0),
    installs,
    downloads: null,
    attributionWindowDays: 30,
    sampleLimit: 200,
  };
}

/** Report from the Android app after reading Google Play Install Referrer. Not a signed store receipt. */
export async function recordInstall(db: any, input: any) {
  if (!validToken(input.receipt)) throw new Error('invalid receipt');
  const seconds = Number(input.installedAt);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    seconds > Math.floor(Date.now() / 1000) + 300
  )
    throw new Error('invalid timestamp');
  const click = await db('marketing.clicks')
    .where({ receipt_hash: tokenHash(input.receipt), destination: 'play-store', automated: false })
    .first();
  if (
    !click ||
    seconds * 1000 < new Date(click.clicked_at).getTime() - 300000 ||
    seconds * 1000 > new Date(click.clicked_at).getTime() + 30 * 86400000
  )
    throw new Error('invalid attribution window');
  await db('marketing.installs')
    .insert({ click_id: click.id, installed_at: new Date(seconds * 1000) })
    .onConflict('click_id')
    .ignore();
  return { recorded: true };
}
