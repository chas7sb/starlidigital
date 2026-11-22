import fs from 'node:fs';

let s = fs.readFileSync('server/src/schema.ts', 'utf8');

if (!s.includes('AssetServices')) {
  s = s.replace("import { createMailboxGraphQL } from './mailbox/graphql.js';",
    "import { createMailboxGraphQL } from './mailbox/graphql.js';\r\nimport { AssetServices } from './assets/service.js';\r\nimport { createAssetGraphQL } from './assets/graphql.js';");

  s = s.replace("const mailboxGql = createMailboxGraphQL({ services: mailboxServices });",
    "const mailboxGql = createMailboxGraphQL({ services: mailboxServices });\r\n  const assetServices = new AssetServices({ store, events });\r\n  const assetGql = createAssetGraphQL({ services: assetServices });");

  s = s.replace("typeDefs: [typeDefs, crmGql.typeDefs, mailboxGql.typeDefs],",
    "typeDefs: [typeDefs, crmGql.typeDefs, mailboxGql.typeDefs, assetGql.typeDefs],");

  s = s.replace("...mailboxGql.resolvers,",
    "...mailboxGql.resolvers,\r\n      ...assetGql.resolvers,");

  s = s.replace("...(mailboxGql.resolvers.Query || {}),",
    "...(mailboxGql.resolvers.Query || {}),\r\n      ...(assetGql.resolvers.Query || {}),");

  fs.writeFileSync('server/src/schema.ts', s, 'utf8');
  console.log('Successfully wired Asset GraphQL into schema.ts');
} else {
  console.log('Already includes AssetServices');
}
