async function getOwnerId(email, salt) {
  const data = new TextEncoder().encode(email + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequest(context) {
  const { request, env } = context;

  const email =
    request.headers.get("Cf-Access-Authenticated-User-Email");

  if (!email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userMap = JSON.parse(env.USER_MAP_JSON || "{}");
  const username = userMap[email];

  if (!username) {
    return new Response("Forbidden", { status: 403 });
  }

  const ownerId = await getOwnerId(email, env.OWNER_SALT);

  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (request.method === "GET") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runs?select=*&order=time_ms.asc`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );

    const data = await res.json();

    // Add canDelete flag
    const enriched = data.map(r => ({
      ...r,
      canDelete: r.owner_id === ownerId,
    }));

    return new Response(JSON.stringify(enriched), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "POST") {
    const body = await request.json();

    const payload = {
      ...body,
      owner_id: ownerId,
      owner_name: username,
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
}