import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function Markdown({children}:{children:string}){
 return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><a href={href} target={href?.startsWith('http')?'_blank':undefined} rel="noopener noreferrer">{children}</a>,img:()=>null}}>{children}</ReactMarkdown>;
}
