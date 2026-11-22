import type { AssetServices } from './service.js';
import { requireUser, fail, type Context } from '../security.js';

export function createAssetGraphQL({ services }: { services: AssetServices }) {
  const typeDefs = `
    type AssetRecord {
      id: String!
      sha256: String!
      mimeType: String!
      byteSize: Int!
      filenameHint: String
      altText: String
      visibility: String!
      url: String!
      createdAt: String!
      prospectId: String
      projectId: String
    }

    extend type Query {
      asset(id: String!): AssetRecord
      assets(prospectId: String, projectId: String, visibility: String): [AssetRecord!]!
    }
  `;

  const resolvers = {
    Query: {
      asset: (_: any, { id }: { id: string }, context: Context) => {
        const user = requireUser(context);
        const record = services.getAsset(id, user);
        if (!record) return null;
        if (record.visibility === 'PRIVATE' && record.ownerId !== user.id && user.role !== 'ADMIN') {
          fail('Nu ai acces la această resursă.', 'FORBIDDEN');
        }
        return record;
      },
      assets: (_: any, args: any, context: Context) => {
        const user = requireUser(context);
        return services.listAssets(args, user);
      }
    }
  };

  return { typeDefs, resolvers };
}
