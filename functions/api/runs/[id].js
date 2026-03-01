async function getOwnerId(email, salt) {
    const data = new TextEncoder().encode(email + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hashBuffer)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

export async function onRequest(context) {
    const { request, env, params } = context;

    if (request.method !== "DELETE") {
        return new Response("Method not allowed", { status: 405 });
    }

    const email =
        request.headers.get("Cf-Access-Authenticated-User-Email");

    if (!email) {
        return new Response("Unauthorized", { status: 401 });
    }

    const ownerId = await getOwnerId(email, env.OWNER_SALT);

    const SUPABASE_URL = env.SUPABASE_URL;
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

    const id = params.id;

    // Verify ownership before deleting
    const check = await fetch(
        `${SUPABASE_URL}/rest/v1/runs?id=eq.${id}&select=owner_id`,
        {
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
            },
        }
    );

    const rows = await check.json();

    if (!rows.length || rows[0].owner_id !== ownerId) {
        return new Response("Forbidden", { status: 403 });
    }

    await fetch(
        `${SUPABASE_URL}/rest/v1/runs?id=eq.${id}`,
        {
            method: "DELETE",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
            },
        }
    );

    return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
    });
}