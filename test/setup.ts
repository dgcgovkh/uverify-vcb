// Config binding is ON by default in uverify: loadContext() refuses a config
// with no `config_token`. Most tests here are about other things and use
// unsigned fixtures, so they opt out explicitly.
//
// The default itself is covered in test/config-binding.ts — see "refuses an
// unsigned config by default". Do not remove that test and rely on this file,
// or the default becomes untested.
process.env.REQUIRE_CONFIG_BINDING = "false";
