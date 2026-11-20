// The portal's connection to its database. Fill in both values from your Supabase project (Project Settings > API):
// the project URL and the publishable key (the one once called "anon"). Both are safe to publish: what a visitor can
// read is decided by the database's access rules, not by keeping this key secret. Never put a secret or
// service-role key here.
//
// While either value is empty the portal runs as a demo that keeps everything in the visitor's own browser.
window.PORTAL_CONFIG = {
  supabaseUrl: 'https://xhrognwsamspkcyjmlos.supabase.co',
  supabaseKey: 'sb_publishable_bLp6Glz4sO2WdCGJlXCx8w_cfE8TD_9',
  owner: 'Dylan',
  home: 'https://dylanhughes.dev',
};
