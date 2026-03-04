export async function onRequestGet({ request, env }) {
  try {
    // Cloudflare Access usually provides one of these (depending on config)
    const email =
      request.headers.get("cf-access-authenticated-user-email") ||
      request.headers.get("Cf-Access-Authenticated-User-Email") ||
      "";

    if (!email) {
      return json({ error: "Not authenticated (no Access email header)" }, 401);
    }

    // Parse USER_MAP_JSON safely
    let userMap = {};
    try {
      userMap = env.USER_MAP_JSON ? JSON.parse(env.USER_MAP_JSON) : {};
    } catch (e) {
      return json(
        { error: "USER_MAP_JSON is not valid JSON", detail: String(e) },
        500
      );
    }

    const username = userMap[email] || "";

    return json({ email, username }, 200);
  } catch (err) {
    return json({ error: "whoami crashed", detail: String(err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}