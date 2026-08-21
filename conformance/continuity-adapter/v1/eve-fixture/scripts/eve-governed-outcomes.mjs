import { cp, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startEveProcess, stopEveProcess } from "./eve-process.mjs";
import { readEveStream } from "./stream.mjs";

const fixtureRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repositoryNodeModules=resolve(fixtureRoot,"../../../..","node_modules");

export async function runEveGovernedOutcomesV1(input){
  const cell=new URL(input.cellUrl);if(!["127.0.0.1","localhost","[::1]"].includes(cell.hostname))throw new TypeError("hermetic Eve governed Outcomes require a loopback Cell");
  const appRoot=await stage(),events=[];let server;
  const env=token=>({...input.env,NODE_PATH:repositoryNodeModules,REELIER_CELL_URL:cell.origin,REELIER_CELL_TOKEN:token});
  try{
    server=await startEveProcess({cwd:appRoot,env:env(input.compositeCellToken)});
    events.push(...await mission(server,input.eveToken,"governed run composite request_composite"));
    await stopEveProcess(server.child);server=undefined;
    await input.afterCompositeCrash();
    server=await startEveProcess({cwd:appRoot,env:env(input.compositeCellToken)});
    events.push(...await mission(server,input.eveToken,"governed resume composite request_composite"));
    await stopEveProcess(server.child);server=await startEveProcess({cwd:appRoot,env:env(input.linearCellToken)});
    events.push(...await mission(server,input.eveToken,"governed run linear-only request_linear"));
    events.push(...await mission(server,input.eveToken,"governed resume linear-only request_linear"));
    const toolCalls=events.filter(row=>row.type==="action.result"&&row?.data?.status==="completed").map(row=>row?.data?.result?.toolName).filter(Boolean);
    const messages=events.filter(row=>row.type==="message.completed"&&typeof row?.data?.message==="string").map(row=>row.data.message);
    return Object.freeze({processRestarts:2,toolCalls:Object.freeze(toolCalls),messages:Object.freeze(messages)});
  }finally{await stopEveProcess(server?.child);await rm(appRoot,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

async function stage(){const root=await mkdtemp(resolve(tmpdir(),"reelier-eve-governed-"));for(const entry of await readdir(fixtureRoot,{withFileTypes:true})){if(["node_modules",".eve",".output","dist","scripts","tests"].includes(entry.name))continue;await cp(resolve(fixtureRoot,entry.name),resolve(root,entry.name),{recursive:true});}await symlink(resolve(fixtureRoot,"node_modules"),resolve(root,"node_modules"),process.platform==="win32"?"junction":"dir");return root;}
async function mission(server,token,message){const response=await server.http.request(new URL("/eve/v1/session",server.url),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({message,operationId:message.replaceAll(" ","-")})});if(response.status!==202)throw new Error(`Eve mission refused with HTTP ${response.status}`);const body=await response.json(),rows=[];let cursor=0;for(let attempt=0;attempt<1200;attempt++){const read=await readEveStream({client:server.http,baseUrl:server.url,sessionId:body.sessionId,token,startIndex:cursor});cursor=read.cursor;rows.push(...read.rows);if(rows.some(row=>row.type==="session.failed"))throw new Error(`Eve mission failed: ${JSON.stringify(rows.slice(-10))}`);if(rows.some(row=>row.type==="session.waiting"))return rows;await new Promise(resolveDelay=>setTimeout(resolveDelay,50));}throw new Error("Eve mission did not settle");}
