// Public browser configuration. This is NOT a service-role key.
window.QUESTBOARD_CONFIG = {
  supabaseUrl: 'https://efehgfntchczottrmosm.supabase.co',
  supabasePublishableKey: 'sb_publishable_GUgYf31vKVtRsu_NNyn_fg_0zgqPyIo',
  minutesUrl: 'https://minutes.dudgeon.io',
  // Enable a provider only after configuring it in Supabase and testing its callback.
  authProviders: { google: true, azure: false },
  buildLabel: 'Pilot v0.1'
};
