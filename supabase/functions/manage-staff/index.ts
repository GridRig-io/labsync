// LabSync · manage-staff
// Lets a lab admin create staff accounts and reset their passwords from the app,
// without exposing the service-role key to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["admin", "supervisor", "inventory_officer", "staff"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Who is calling?
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("lab_id, role, is_active").eq("id", user.id).single();
  if (!me || !me.is_active || me.role !== "admin" || !me.lab_id) {
    return json({ error: "Only a lab admin can manage staff accounts" }, 403);
  }

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  if (body.action === "create") {
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const role = ROLES.includes(body.role) ? body.role : "staff";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name || email.split("@")[0] },
      app_metadata: { lab_id: me.lab_id, role },
    });
    if (error) {
      const msg = /already/i.test(error.message) ? "An account with this email already exists" : error.message;
      return json({ error: msg }, 400);
    }
    if (body.job_title) {
      await admin.from("profiles").update({ job_title: body.job_title }).eq("id", data.user.id);
    }
    return json({ id: data.user.id });
  }

  if (body.action === "reset_password") {
    const password = body.password ?? "";
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { data: target } = await admin.from("profiles").select("lab_id").eq("id", body.user_id).single();
    if (!target || target.lab_id !== me.lab_id) return json({ error: "User not found in your lab" }, 404);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
