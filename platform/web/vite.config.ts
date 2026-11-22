import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(()=>{
 const env=loadEnv('development','..','');
 const api=`http://127.0.0.1:${env.PORT||4100}`;
 return {plugins:[react()],build:{rollupOptions:{output:{manualChunks:{markdown:['react-markdown','remark-gfm'],'react-vendor':['react','react-dom','react-router-dom']}}}},server:{port:Number(env.WEB_PORT||5173),strictPort:true,proxy:{'/graphql':{target:api,ws:true},'/health':api}}};
});
