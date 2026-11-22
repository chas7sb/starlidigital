import { z } from 'zod';
import type { ToolContext } from './common.js';
import { jsonResponse, errorResponse } from './common.js';
import { hasScope } from './security.js';

export function registerAssetTools(ctx: ToolContext) {
  const { server, principal, store, assetServices, auditCall } = ctx;

  // 1. assets_list
  server.tool(
    'assets_list',
    'List uploaded or AI-generated media assets (logos, hero images, banners). Returns metadata and URLs; never dumps giant base64 payloads. (Read-Only)',
    {
      projectId: z.string().optional().describe('Filter assets by associated project ID'),
      prospectId: z.string().optional().describe('Filter assets by prospect/company ID'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Max assets to return'),
    },
    async (args) => {
      const start = Date.now();
      if (!hasScope(principal, 'read')) {
        auditCall('assets_list', undefined, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: requires read scope', 'UNAUTHORIZED');
      }

      try {
        let assets: any[] = [];
        if (assetServices) {
          assets = await assetServices.listAssets({
            projectId: args.projectId,
            prospectId: args.prospectId,
          });
        } else if (store) {
          assets = store.list('asset-records');
          if (args.projectId) assets = assets.filter((a) => a.projectId === args.projectId);
          if (args.prospectId) assets = assets.filter((a) => a.prospectId === args.prospectId);
        }

        const paged = assets.slice(0, args.limit || 20).map((a) => ({
          id: a.id,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          width: a.width,
          height: a.height,
          altText: a.altText,
          url: a.url || `/media/assets/${a.id}`,
          createdAt: a.createdAt,
        }));

        auditCall('assets_list', undefined, start, 'SUCCESS', args, { count: paged.length });
        return jsonResponse({ total: assets.length, assets: paged });
      } catch (err: any) {
        auditCall('assets_list', undefined, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`assets_list failed: ${err.message}`);
      }
    }
  );

  // 2. asset_manage
  server.tool(
    'asset_manage',
    'Retrieve asset metadata or delete an asset. (Read/Write)',
    {
      action: z.enum(['get', 'delete']).describe('Asset action'),
      assetId: z.string().describe('The unique asset ID (ast-...)'),
    },
    async (args) => {
      const start = Date.now();
      const isWrite = args.action === 'delete';
      if (!hasScope(principal, isWrite ? 'write' : 'read')) {
        auditCall('asset_manage', args.assetId, start, 'DENIED', args, undefined, 'Insufficient scope');
        return errorResponse('Access denied: insufficient scope', 'UNAUTHORIZED');
      }

      try {
        if (args.action === 'get') {
          let asset: any;
          if (assetServices) {
            asset = await assetServices.getAsset(args.assetId);
          } else if (store) {
            asset = store.get('asset-records', args.assetId);
          }
          if (!asset) return errorResponse(`Asset ${args.assetId} not found`, 'NOT_FOUND');

          auditCall('asset_manage', args.assetId, start, 'SUCCESS', args);
          return jsonResponse({
            id: asset.id,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            url: asset.url || `/media/assets/${asset.id}`,
            altText: asset.altText,
            createdAt: asset.createdAt,
          });
        }

        if (args.action === 'delete') {
          if (store) {
            store.remove('asset-records', args.assetId);
          }
          auditCall('asset_manage', args.assetId, start, 'SUCCESS', args);
          return jsonResponse({ status: 'DELETED', assetId: args.assetId });
        }

        return errorResponse(`Invalid action ${args.action}`);
      } catch (err: any) {
        auditCall('asset_manage', args.assetId, start, 'FAILED', args, undefined, err.message);
        return errorResponse(`asset_manage failed: ${err.message}`);
      }
    }
  );
}
