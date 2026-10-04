import { EVENT } from "./config.js";

const SUPABASE_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

let clientPromise;

function client() {
  if (!clientPromise) {
    clientPromise = import(SUPABASE_ESM).then(({ createClient }) =>
      createClient(EVENT.supabaseUrl, EVENT.supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    );
  }
  return clientPromise;
}

export async function rpc(fn, args) {
  const supabase = await client();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const err = new Error("request failed");
    err.cause = error;
    throw err;
  }
  return data;
}
