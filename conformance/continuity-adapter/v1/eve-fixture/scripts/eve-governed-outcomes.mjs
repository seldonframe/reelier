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
  const appRoot=await stage(),events=[],sessionIds=[],processIdentities=[];let server;
  const env=token=>({...input.env,NODE_PATH:repositoryNodeModules,REELIER_CELL_URL:cell.origin,REELIER_CELL_TOKEN:token});
  try{
    server=await startEveProcess({cwd:appRoot,env:env(input.compositeCellToken)});
    processIdentities.push(processIdentity(server));
    {const result=await mission(server,input.eveToken,"governed run composite request_composite");events.push(...result.rows);sessionIds.push(result.sessionId);}
    await stopEveProcess(server.child);server=undefined;
    await input.afterCompositeCrash();
    server=await startEveProcess({cwd:appRoot,env:env(input.compositeCellToken)});
    processIdentities.push(processIdentity(server));
    {const result=await mission(server,input.eveToken,"governed resume composite request_composite");events.push(...result.rows);sessionIds.push(result.sessionId);}
    await stopEveProcess(server.child);server=await startEveProcess({cwd:appRoot,env:env(input.linearCellToken)});
    processIdentities.push(processIdentity(server));
    {const result=await mission(server,input.eveToken,"governed run linear-only request_linear");events.push(...result.rows);sessionIds.push(result.sessionId);}
    {const result=await mission(server,input.eveToken,"governed resume linear-only request_linear");events.push(...result.rows);sessionIds.push(result.sessionId);}
    const requested=events.filter(row=>row.type==="actions.requested").flatMap(row=>Array.isArray(row?.data?.actions)?row.data.actions:[]).map(action=>action?.toolName).filter(name=>typeof name==="string");
    const completed=events.filter(row=>row.type==="action.result"&&row?.data?.status==="completed").map(row=>row?.data?.result?.toolName).filter(name=>typeof name==="string");
    const failed=events.filter(row=>row.type==="action.result"&&row?.data?.status!=="completed").map(row=>row?.data?.result?.toolName??"unknown-action-result");
    const toolEvents=events.filter(row=>typeof row.type==="string"&&row.type.startsWith("action.")).map(row=>row.data);
    const messages=events.filter(row=>row.type==="message.completed"&&typeof row?.data?.message==="string").map(row=>row.data.message);
    return Object.freeze({processIdentities:Object.freeze(processIdentities),processRestarts:Math.max(0,processIdentities.length-1),sessionIds:Object.freeze(sessionIds),actions:Object.freeze({requested:Object.freeze(requested),completed:Object.freeze(completed),failed:Object.freeze(failed)}),toolEvents:Object.freeze(toolEvents),messages:Object.freeze(messages)});
  }finally{await stopEveProcess(server?.child);await rm(appRoot,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

function processIdentity(server){if(!Number.isSafeInteger(server.pid)||server.pid<1||!Number.isSafeInteger(server.port)||server.port<1||typeof server.startedAt!=="string"||typeof server.processNonce!=="string")throw new TypeError("Eve process identity is incomplete");return Object.freeze({pid:server.pid,port:server.port,startedAt:server.startedAt,processNonce:server.processNonce});}

async function stage(){const root=await mkdtemp(resolve(tmpdir(),"reelier-eve-governed-"));for(const entry of await readdir(fixtureRoot,{withFileTypes:true})){if(["node_modules",".eve",".output","dist","scripts","tests"].includes(entry.name))continue;await cp(resolve(fixtureRoot,entry.name),resolve(root,entry.name),{recursive:true});}await symlink(resolve(fixtureRoot,"node_modules"),resolve(root,"node_modules"),process.platform==="win32"?"junction":"dir");return root;}
async function mission(server,token,message){const response=await server.http.request(new URL("/eve/v1/session",server.url),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({message,operationId:message.replaceAll(" ","-")})});if(response.status!==202)throw new Error(`Eve mission refused with HTTP ${response.status}`);const body=await response.json(),rows=[];let cursor=0;for(let attempt=0;attempt<1200;attempt++){const read=await readEveStream({client:server.http,baseUrl:server.url,sessionId:body.sessionId,token,startIndex:cursor});cursor=read.cursor;rows.push(...read.rows);if(rows.some(row=>row.type==="session.failed"))throw new Error(`Eve mission failed: ${JSON.stringify(rows.slice(-10))}`);if(rows.some(row=>row.type==="session.waiting"))return {sessionId:body.sessionId,rows};await new Promise(resolveDelay=>setTimeout(resolveDelay,50));}throw new Error("Eve mission did not settle");}
