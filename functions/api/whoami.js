export async function onRequest(context) {
    const { env, request } = context;

    // Cloudflare Access header
    const email =
        request.headers.get("Cf-Access-Authenticated-User-Email");

    if (!email) {
        return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401 }
        );
    }

    const userMap = JSON.parse(env.USER_MAP_JSON || "{}");

    const username = userMap[email];

    if (!username) {
        return new Response(
            JSON.stringify({ error: "User not allowed" }),
            { status: 403 }
        );
    }

    return new Response(
        JSON.stringify({ username }),
        { headers: { "Content-Type": "application/json" } }
    );
}