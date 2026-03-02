export async function onRequest(context) {
    const { env, request } = context;

    // Cloudflare Access header (prod)
    let email = request.headers.get("Cf-Access-Authenticated-User-Email");

    // DEV fallback: allow test email via ?as= or X-Dev-User header
    if (!email) {
        email =
            request.headers.get("X-Dev-User") ||
            new URL(request.url).searchParams.get("as") ||
            null;
    }

    if (!email) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const userMap = JSON.parse(env.USER_MAP_JSON || "{}");
    const username = userMap[email];

    if (!username) {
        return new Response(JSON.stringify({ error: "User not allowed" }), { status: 403 });
    }

    return new Response(JSON.stringify({ username }), {
        headers: { "Content-Type": "application/json" },
    });
}