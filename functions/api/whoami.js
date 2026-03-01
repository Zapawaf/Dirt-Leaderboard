// functions/api/whoami.js
export async function onRequest({ request, env }) {
    // Cloudflare Access identity headers (case-insensitive, but we'll check common forms)
    const email =
        request.headers.get("cf-access-authenticated-user-email") ||
        request.headers.get("Cf-Access-Authenticated-User-Email") ||
        request.headers.get("CF-Access-Authenticated-User-Email");

    // Optional dev/testing override:
    const url = new URL(request.url);
    const as = url.searchParams.get("as"); // e.g. /api/whoami?as=test@example.com

    const effectiveEmail = (email || as || "").trim().toLowerCase();

    if (!effectiveEmail) {
        return json(
            { username: null, error: "No authenticated email header found (are you behind Cloudflare Access?)" },
            401
        );
    }

    // USER_MAP_JSON example:
    // {"zapawaf1@gmail.com":"Zapawaf","friend1@gmail.com":"Friend1"}
    let userMap = {};
    try {
        userMap = JSON.parse(env.USER_MAP_JSON || "{}");
    } catch {
        return json({ username: null, error: "USER_MAP_JSON is not valid JSON" }, 500);
    }

    const username = userMap[effectiveEmail] || null;

    if (!username) {
        // Don't leak email; tell you it wasn't mapped
        return json({ username: null, error: "Email is authenticated but not mapped to a username" }, 403);
    }

    return json({ username });
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}