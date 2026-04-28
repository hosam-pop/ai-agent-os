#!/usr/bin/env node
// =============================================================================
// promote-admin.js
//
// One-off helper to elevate a LibreChat user to the ADMIN role. This is needed
// after the first OIDC login because LibreChat assigns every new user to USER
// by default — and the ADMIN role is what unlocks agent/prompt builders when
// USER permissions are restricted.
//
// Run from inside the LibreChat Fly machine (after `flyctl ssh console`):
//   node /app/librechat-scripts/promote-admin.js <email>
//
// …or pipe it in from CI / an ops box:
//   flyctl ssh console -a ai-agent-os-librechat -C \
//     "node -e \"$(cat deploy/librechat/scripts/promote-admin.js)\"" <email>
// =============================================================================
const path = require('path')
require('module-alias')({ base: path.resolve('/app/api') })
const mongoose = require('mongoose')
const { User } = require('@librechat/data-schemas').createModels(mongoose)
const connect = require('/app/config/connect')

const targetEmail = process.argv[2]
if (!targetEmail) {
  console.error('usage: promote-admin.js <email>')
  process.exit(2)
}

;(async () => {
  await connect()
  const res = await User.updateOne(
    { email: targetEmail },
    { $set: { role: 'ADMIN' } },
  )
  const u = await User.findOne({ email: targetEmail }, 'email role').lean()
  if (!u) {
    console.error(`no user found with email=${targetEmail}`)
    process.exit(1)
  }
  console.log(
    JSON.stringify(
      {
        email: u.email,
        role: u.role,
        matched: res.matchedCount,
        modified: res.modifiedCount,
      },
      null,
      2,
    ),
  )
  process.exit(0)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
