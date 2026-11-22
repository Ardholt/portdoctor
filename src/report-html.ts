import type { Finding, ScanResult, Severity } from './types.ts';
import { SEVERITIES } from './types.ts';
import { groupFindings, startHere, fmtRange, totalEffort } from './group.ts';

const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Kept for API compatibility: a rough range, never a single figure. */
export function fmtEffort(min: number): string {
  return fmtRange(min);
}

export function effortHead(min: number): string {
  return fmtRange(min, false).replace(/^about /, '');
}

const SEV_GLYPH: Record<Severity, string> = { blocker: '■', major: '▲', minor: '●', info: '○' };
const SEV_HELP: Record<Severity, string> = {
  blocker: 'Likely will not build or has no direct QNX equivalent',
  major: 'Needs a semantic change to port',
  minor: 'Small mechanical change',
  info: 'Worth checking, probably fine',
};

const LIGHT = `--bg:#f4f6f9;--surface:#ffffff;--surface2:#eef1f6;--text:#14181f;--muted:#566071;--border:#d5dae3;--accent:#0a58c9;--heat:#d9480f;
--blocker:#a8200f;--blocker-bg:#fde6e3;--major:#9a3f00;--major-bg:#fdecd3;--minor:#17559e;--minor-bg:#e1eefc;--info:#41495a;--info-bg:#e9ecf1;--hl:#fff3bf;--code:#f6f8fa;`;
const DARK = `--bg:#0e1218;--surface:#161b23;--surface2:#1d2430;--text:#e7eaf0;--muted:#9aa4b5;--border:#2b3342;--accent:#79afff;--heat:#ff7a3d;
--blocker:#ff9a8f;--blocker-bg:#3d1a17;--major:#ffbb6b;--major-bg:#3b2a12;--minor:#86bcff;--minor-bg:#14283f;--info:#b2bac8;--info-bg:#232b37;--hl:#4a3f10;--code:#10151c;`;

const CSS = `
:root{${LIGHT}color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}color-scheme:dark}}
:root[data-theme=dark]{${DARK}color-scheme:dark}
*{box-sizing:border-box}
html{scroll-padding-top:9rem}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-999px;top:0;background:var(--accent);color:#fff;padding:.5rem 1rem;z-index:50}
.skip:focus{left:0}
header.top{padding:1.5rem clamp(1rem,4vw,3rem) 1rem;border-bottom:1px solid var(--border);background:var(--surface)}
header.top h1{margin:0;font-size:1.6rem;letter-spacing:-.01em}
header.top h1 span{color:var(--muted);font-weight:400}
.sub{color:var(--muted);margin:.25rem 0 0}
.banner{margin:.8rem 0 0;padding:.35rem .8rem;border-left:4px solid var(--major);background:var(--major-bg);color:var(--text);border-radius:6px;font-size:.9rem}
.banner summary{cursor:pointer}.banner p{margin:.4rem 0}
main{padding:1.25rem clamp(1rem,4vw,3rem) 4rem;max-width:1200px;margin:0 auto}
h2{font-size:1.15rem;margin:2rem 0 .75rem}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}
@media (min-width:640px){.cards{grid-template-columns:repeat(4,1fr)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem}
.card .n{font-size:1.8rem;font-weight:700;line-height:1.1}
.card .l{color:var(--muted);font-size:.85rem}
.card.sev-blocker .n{color:var(--blocker)}.card.sev-major .n{color:var(--major)}.card.sev-minor .n{color:var(--minor)}.card.sev-info .n{color:var(--info)}
.heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.5rem;padding:0;margin:0;list-style:none}
.tile{width:100%;text-align:left;font:inherit;color:var(--text);cursor:pointer;border:1px solid var(--border);border-radius:8px;padding:.55rem .7rem;
 background:color-mix(in srgb,var(--heat) calc(var(--i) * 1%),var(--surface));min-height:4.2rem;display:block}
.tile:hover{border-color:var(--heat)}
.tile[aria-pressed=true]{outline:3px solid var(--accent);outline-offset:1px}
.tile .d{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;word-break:break-all;display:block}
.tile .m{font-size:.8rem;color:var(--text);opacity:.85;display:block;margin-top:.2rem}
.legend{display:flex;gap:.6rem;align-items:center;color:var(--muted);font-size:.82rem;margin:.5rem 0 0}
.legend i{display:inline-block;width:5rem;height:.6rem;border-radius:3px;border:1px solid var(--border);background:linear-gradient(90deg,var(--surface),color-mix(in srgb,var(--heat) 55%,var(--surface)))}
.bar{position:sticky;top:0;z-index:20;background:var(--bg);padding:.7rem 0;border-bottom:1px solid var(--border);display:none;gap:.5rem;flex-wrap:wrap;align-items:center}
.js .bar{display:flex}
.bar input[type=search],.bar select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.4rem .6rem}
.bar input[type=search]{min-width:15rem;flex:1}
.chip,.btn{font:inherit;cursor:pointer;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:.3rem .8rem}
.btn{border-radius:8px}
.chip[aria-pressed=true]{background:var(--surface2);border-color:var(--accent);font-weight:600}
.chip[aria-pressed=false]{opacity:.65}
#count{color:var(--muted);font-size:.88rem;margin-left:auto}
details.file{background:var(--surface);border:1px solid var(--border);border-radius:10px;margin:.6rem 0}
details.file>summary{cursor:pointer;padding:.65rem .9rem;list-style:none;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
details.file>summary::-webkit-details-marker{display:none}
details.file>summary::before{content:"\\25B8";color:var(--muted)}
details.file[open]>summary::before{content:"\\25BE"}
.path{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9rem;word-break:break-all}
.meta{color:var(--muted);font-size:.82rem}
.finding{border-top:1px solid var(--border);padding:.8rem .9rem}
.finding:focus{outline:3px solid var(--accent);outline-offset:-3px}
.finding h3{margin:0 0 .3rem;font-size:1rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.badge{font-size:.74rem;font-weight:700;border-radius:5px;padding:.05rem .45rem;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
.b-blocker{color:var(--blocker);background:var(--blocker-bg)}.b-major{color:var(--major);background:var(--major-bg)}
.b-minor{color:var(--minor);background:var(--minor-bg)}.b-info{color:var(--info);background:var(--info-bg)}
.b-guess{color:var(--major);border:1px dashed var(--major);text-transform:none}
.b-known{color:var(--muted);border:1px solid var(--border);text-transform:none}
.loc{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;color:var(--muted)}
pre.code{margin:.5rem 0;padding:.4rem 0;background:var(--code);border:1px solid var(--border);border-radius:8px;overflow:auto;font:.82rem/1.45 ui-monospace,Menlo,Consolas,monospace}
pre.code .ln{display:block;padding:0 .8rem;white-space:pre}
pre.code .ln b{display:inline-block;width:3.2em;color:var(--muted);font-weight:400;user-select:none}
pre.code .hit{background:var(--hl);box-shadow:inset 3px 0 0 var(--major)}
.remedy{margin:.4rem 0;padding:.5rem .75rem;border-left:3px solid var(--accent);background:var(--surface2);border-radius:0 6px 6px 0}
.remedy strong{display:block;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.verify{color:var(--major);font-size:.88rem;margin:.3rem 0}
.note{color:var(--muted);font-size:.85rem}
section.rule{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin:.6rem 0}
section.rule h3{margin:0 0 .3rem;font-size:1rem}
section.rule:target{outline:3px solid var(--accent)}
.empty{padding:2rem;text-align:center;color:var(--muted)}
.js .empty{display:none}.js .empty.show{display:block}
dialog{border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);max-width:30rem}
dialog::backdrop{background:#0008}
kbd{font:.8rem ui-monospace,Menlo,monospace;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:0 .35rem}
footer{color:var(--muted);font-size:.85rem;margin-top:2.5rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.start{margin:0;padding:0;list-style:none;display:grid;gap:.6rem;counter-reset:s}
.start li{counter-increment:s;background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--blocker);border-radius:10px;padding:.7rem 1rem .7rem 3rem;position:relative}
.start li::before{content:counter(s);position:absolute;left:1rem;top:.55rem;font-size:1.5rem;font-weight:700;color:var(--muted)}
.start a.t{font-weight:700;font-size:1.02rem}
.start .r{margin:.2rem 0 0;color:var(--text);font-size:.92rem}
.scalebar{display:flex;gap:.6rem;align-items:center;margin:0 0 .6rem;flex-wrap:wrap}
details.grp{background:var(--surface);border:1px solid var(--border);border-radius:10px;margin:.6rem 0}
details.grp>summary{cursor:pointer;padding:.65rem .9rem;list-style:none;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
details.grp>summary::-webkit-details-marker{display:none}
details.grp>summary::before{content:"\\25B8";color:var(--muted)}
details.grp[open]>summary::before{content:"\\25BE"}
details.grp:target{outline:3px solid var(--accent)}
.grp-body{padding:0 .9rem .6rem;border-top:1px solid var(--border)}
.sites{list-style:none;margin:.5rem 0 0;padding:0}
.site{border-top:1px dashed var(--border);padding:.5rem 0}
.site>summary{cursor:pointer;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap;list-style:none}
.site>summary::-webkit-details-marker{display:none}
.site>summary::before{content:"\\25B8";color:var(--muted)}
.site[open]>summary::before{content:"\\25BE"}
.site .hitline{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;color:var(--muted);word-break:break-all}
@media print{.bar,.skip,#themebtn,#helpbtn,.scalebar{display:none!important}details.grp>*,details.site>*{display:block!important}}
@media (prefers-reduced-motion:no-preference){.tile,.chip{transition:border-color .15s,background .15s}}
`;

const JS = `
(function(){
var root=document.documentElement;root.classList.add('js');
var $=function(s,c){return (c||document).querySelector(s)},$$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
var state={sev:{blocker:1,major:1,minor:1,info:1},conf:'all',dir:null,q:'',guard:true,unbuilt:true,scale:'rel'};
var findings=$$('article.finding'),groups=$$('details.grp'),count=$('#count'),empty=$('.empty');
function setScale(){
 $$('.tile').forEach(function(t){t.style.setProperty('--i',state.scale==='abs'?t.dataset.abs:t.dataset.rel)});
 var b=$('#scale');if(b){b.setAttribute('aria-pressed',state.scale==='abs'?'true':'false');b.textContent=state.scale==='abs'?'Scale: share of total (absolute)':'Scale: relative to busiest'}
 $$('.lg-rel').forEach(function(e){e.hidden=state.scale==='abs'});$$('.lg-abs').forEach(function(e){e.hidden=state.scale!=='abs'});
}
function apply(){
 var q=state.q.toLowerCase().trim(),vis=0,i;
 for(i=0;i<findings.length;i++){var f=findings[i],d=f.dataset,ok=true;
  if(!state.sev[d.sev])ok=false;
  if(ok&&state.conf!=='all'&&d.conf!==state.conf)ok=false;
  if(ok&&state.dir!==null&&!(state.dir==='.'?d.file.indexOf('/')<0:(d.file===state.dir||d.file.indexOf(state.dir+'/')===0)))ok=false;
  if(ok&&!state.guard&&d.guard==='linux-only')ok=false;
  if(ok&&!state.unbuilt&&d.built==='no')ok=false;
  if(ok&&q&&d.text.indexOf(q)<0)ok=false;
  f.hidden=!ok;var site=f.closest('details.site');if(site)site.hidden=!ok;if(ok)vis++;}
 groups.forEach(function(g){var n=$$('article.finding:not([hidden])',g).length;g.hidden=n===0;var c=$('.vis',g);if(c)c.textContent=n;});
 count.textContent=vis+' of '+findings.length+' findings shown';
 if(empty)empty.classList.toggle('show',vis===0);
 $$('[data-sevbtn]').forEach(function(b){b.setAttribute('aria-pressed',state.sev[b.dataset.sevbtn]?'true':'false')});
 $$('.tile').forEach(function(t){t.setAttribute('aria-pressed',state.dir!==null&&t.dataset.dir===state.dir?'true':'false')});
}
$$('[data-sevbtn]').forEach(function(b){b.addEventListener('click',function(){state.sev[b.dataset.sevbtn]=state.sev[b.dataset.sevbtn]?0:1;apply()})});
$$('.tile').forEach(function(t){t.addEventListener('click',function(){state.dir=state.dir===t.dataset.dir?null:t.dataset.dir;apply();if(state.dir!==null){var l=$('#findings');if(l)l.scrollIntoView()}})});
var sc=$('#scale');if(sc)sc.addEventListener('click',function(){state.scale=state.scale==='abs'?'rel':'abs';setScale()});
var qi=$('#q');qi.addEventListener('input',function(){state.q=qi.value;apply()});
$('#conf').addEventListener('change',function(e){state.conf=e.target.value;apply()});
$('#guard').addEventListener('change',function(e){state.guard=e.target.checked;apply()});
var ub=$('#unbuilt');if(ub)ub.addEventListener('change',function(e){state.unbuilt=e.target.checked;apply()});
$('#clear').addEventListener('click',function(){state={sev:{blocker:1,major:1,minor:1,info:1},conf:'all',dir:null,q:'',guard:true,unbuilt:true,scale:state.scale};qi.value='';$('#conf').value='all';$('#guard').checked=true;if(ub)ub.checked=true;apply()});
$('#expand').addEventListener('click',function(){var any=groups.some(function(f){return !f.open&&!f.hidden});groups.forEach(function(f){f.open=any});this.textContent=any?'Collapse all groups':'Expand all groups'});
function theme(t){if(t)root.setAttribute('data-theme',t);else root.removeAttribute('data-theme');try{if(t)localStorage.setItem('pd-theme',t)}catch(e){}}
try{var st=localStorage.getItem('pd-theme');if(st)root.setAttribute('data-theme',st)}catch(e){}
function toggleTheme(){var cur=root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');theme(cur==='dark'?'light':'dark')}
$('#themebtn').addEventListener('click',toggleTheme);
var dlg=$('#help');function help(){if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','')}
$('#helpbtn').addEventListener('click',help);
var cur=-1;function vis(){return findings.filter(function(f){return !f.hidden})}
function openUp(el){var d=el.closest('details');while(d){d.open=true;d=d.parentElement&&d.parentElement.closest('details')}}
function go(n){var v=vis();if(!v.length)return;cur=Math.max(0,Math.min(v.length-1,n));var f=v[cur];openUp(f);f.focus();f.scrollIntoView({block:'center'})}
document.addEventListener('keydown',function(e){
 var t=e.target,typing=t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA');
 if(e.key==='Escape'){if(typing){t.blur();return}if(dlg.open){dlg.close();return}if(state.dir!==null){state.dir=null;apply()}return}
 if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key==='/'){e.preventDefault();qi.focus()}
 else if(e.key==='j'){var v=vis(),i=v.indexOf(document.activeElement);go(i>=0?i+1:cur+1)}
 else if(e.key==='k'){var v2=vis(),i2=v2.indexOf(document.activeElement);go(i2>=0?i2-1:cur-1)}
 else if(e.key==='t')toggleTheme();
 else if(e.key==='?')help();
 else if('1234'.indexOf(e.key)>=0&&e.key){var s=['blocker','major','minor','info'][+e.key-1];state.sev[s]=state.sev[s]?0:1;apply()}
});
function hashOpen(){var h=location.hash;if(h.length>1){var el=document.getElementById(decodeURIComponent(h.slice(1)));if(el){openUp(el)}}}
window.addEventListener('hashchange',hashOpen);hashOpen();
setScale();apply();
})();
`;

function dirOf(file: string): string {
  const parts = file.split('/');
  parts.pop();
  return parts.length ? parts.slice(0, 2).join('/') : '.';
}

function renderSite(f: Finding, idx: number): string {
  const code = f.context.length
    ? `<pre class="code" tabindex="0" aria-label="Code context for ${esc(f.file)} line ${f.line}">${f.context
        .map((c) => `<span class="ln${c.n === f.line ? ' hit' : ''}"><b>${c.n}</b>${esc(c.text) || ' '}</span>`)
        .join('')}</pre>`
    : '<p class="note">Project-level finding (no single source line).</p>';
  const guardNote =
    f.guard === 'linux-only'
      ? '<p class="note">Inside a Linux-only <code>#if</code> block: probably already isolated, but check that a QNX branch exists.</p>'
      : f.guard === 'other' && f.guards.length
        ? `<p class="note">Inside conditional(s): <code>${esc(f.guards.join(' > '))}</code>. PortDoctor does not judge whether these are enabled on QNX.</p>`
        : '';
  const builtNote = f.built === 'no' ? '<p class="note"><strong>Build awareness (heuristic):</strong> this file does not appear in the build target list, so it may not be compiled for the target.</p>' : '';
  const text = `${f.ruleId} ${f.title} ${f.file} ${f.match} ${f.message}`.toLowerCase();
  const hit = f.context.find((c) => c.n === f.line);
  return `<details class="site"><summary><span class="loc">${esc(f.file)}:${f.line}</span>${f.guard === 'linux-only' ? ' <span class="badge b-info">Linux-only #if</span>' : f.guard === 'other' ? ' <span class="badge b-info">guarded</span>' : ''}${f.built === 'no' ? ' <span class="badge b-info">not in build list?</span>' : ''}<span class="hitline">${esc((hit?.text ?? f.match).trim().slice(0, 90))}</span></summary>
<article class="finding" id="f-${idx}" tabindex="-1" data-sev="${f.severity}" data-conf="${f.confidence}" data-file="${esc(f.file)}" data-guard="${f.guard}" data-built="${f.built ?? ''}" data-text="${esc(text)}" aria-label="${esc(f.title)} at ${esc(f.file)} line ${f.line}">
${code}${guardNote}${builtNote}
<p class="note">Finding index ${idx} (for <code>portdoctor propose --finding ${idx}</code>)</p>
</article></details>`;
}

export function renderHtml(res: ScanResult): string {
  const s = res.stats;
  const groups = groupFindings(res);
  const total = totalEffort(groups);
  const top = startHere(groups, 3);
  const dirStats = new Map<string, { n: number; w: number; bySev: Record<Severity, number> }>();
  const nDirs = new Set(res.findings.map((f) => dirOf(f.file))).size;
  const byFileTiles = nDirs < 4;
  for (const f of res.findings) {
    const d = byFileTiles ? f.file : dirOf(f.file);
    const e = dirStats.get(d) ?? { n: 0, w: 0, bySev: { blocker: 0, major: 0, minor: 0, info: 0 } };
    e.n++;
    e.w += f.effort;
    e.bySev[f.severity]++;
    dirStats.set(d, e);
  }
  const maxW = Math.max(1, ...[...dirStats.values()].map((d) => d.w));
  const sumW = Math.max(1, [...dirStats.values()].reduce((a, d) => a + d.w, 0));
  const tiles = [...dirStats.entries()].sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1)).slice(0, byFileTiles ? 24 : 400);
  const heat = tiles.length
    ? `<div class="scalebar"><button type="button" class="btn" id="scale" aria-pressed="false">Scale: relative to busiest</button>
<span class="legend"><span class="lg-rel">colour is relative to the busiest tile</span><span class="lg-abs" hidden>colour is each tile's share of all findings' weight</span><i></i><span>less &rarr; more</span></span></div>
<ul class="heat">${tiles
        .map(([d, e]) => {
          const rel = Math.round(8 + (e.w / maxW) * 47);
          const abs = Math.round(8 + (e.w / sumW) * 47);
          return `<li><button type="button" class="tile" style="--i:${rel}" data-rel="${rel}" data-abs="${abs}" data-dir="${esc(d)}" aria-pressed="false" aria-label="${byFileTiles ? 'File' : 'Directory'} ${esc(d)}: ${e.n} findings. Press to filter.">
<span class="d">${esc(byFileTiles ? d : d === '.' ? '(top level)' : d + '/')}</span><span class="m">${e.n} finding${e.n === 1 ? '' : 's'}</span><span class="m">${e.bySev.blocker ? `■${e.bySev.blocker} ` : ''}${e.bySev.major ? `▲${e.bySev.major} ` : ''}${e.bySev.minor ? `●${e.bySev.minor} ` : ''}${e.bySev.info ? `○${e.bySev.info}` : ''}</span></button></li>`;
        })
        .join('')}</ul><p class="note">Press a tile to filter the findings below to it; press again (or Esc) to clear.</p>`
    : '<p class="empty show">No findings.</p>';

  const startHtml = top.length
    ? `<ol class="start">${top
        .map(
          (g) => `<li><a class="t" href="#rule-${esc(g.ruleId)}">${esc(g.title)}</a> <span class="badge b-${g.severity}"><span aria-hidden="true">${SEV_GLYPH[g.severity]}</span> ${g.severity}</span> <span class="badge ${g.confidence === 'guess' ? 'b-guess' : 'b-known'}">${g.confidence === 'guess' ? 'guess: verify against SDP' : 'known'}</span>
<div class="meta">${g.sites.length} site${g.sites.length === 1 ? '' : 's'} in ${g.files.length} file${g.files.length === 1 ? '' : 's'} &middot; ${esc(fmtRange(g.effortMin))}${g.allGuarded ? ' &middot; all inside Linux-only #if' : ''}</div>
<p class="r">${esc(firstSentence(g.rule?.remedy ?? ''))}</p></li>`,
        )
        .join('')}</ol><p class="note">Ranked by: has a site outside Linux-only #if, then severity, then number of sites. A heuristic ordering, not a plan.</p>`
    : '<p class="note">Nothing to start with: no blocker, major or minor findings.</p>';

  const groupsHtml = groups
    .map((g) => {
      const r = g.rule;
      const sites = g.sites
        .slice()
        .sort((a, b) => (res.findings[a].file < res.findings[b].file ? -1 : res.findings[a].file > res.findings[b].file ? 1 : res.findings[a].line - res.findings[b].line))
        .map((i) => renderSite(res.findings[i], i))
        .join('\n');
      return `<details class="grp" id="rule-${esc(g.ruleId)}"><summary><span class="badge b-${g.severity}" title="${esc(SEV_HELP[g.severity])}"><span aria-hidden="true">${SEV_GLYPH[g.severity]}</span> ${g.severity}</span>
<strong>${esc(g.title)}</strong>
<span class="badge ${g.confidence === 'guess' ? 'b-guess' : 'b-known'}" title="${g.confidence === 'guess' ? 'Unverified claim about QNX 8.0: verify against the SDP' : 'Documented QNX/POSIX behaviour (recalled, not checked against an SDP in this build)'}">${g.confidence === 'guess' ? 'guess: verify against SDP' : 'known'}</span>
<span class="meta"><span class="vis">${g.sites.length}</span>/${g.sites.length} sites in ${g.files.length} file${g.files.length === 1 ? '' : 's'} &middot; ${esc(fmtRange(g.effortMin))}</span></summary>
<div class="grp-body"><p><span class="note">${esc(g.ruleId)}</span> ${esc(r?.message ?? '')}</p>
<div class="remedy"><strong>Remedy</strong>${esc(r?.remedy ?? '')}</div>
${r?.verify ? `<p class="verify">⚠ ${esc(r.verify)}</p>` : ''}${r?.refs?.length ? `<p class="note">Documentation to read (names only, not fetched by this tool): ${r.refs.map(esc).join('; ')}</p>` : ''}
${sites}</div></details>`;
    })
    .join('\n');

  const confKnown = res.findings.filter((f) => f.confidence === 'known').length;
  const data = JSON.stringify({ tool: res.tool, version: res.version, stats: res.stats }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PortDoctor report: ${esc(res.root)}</title>
<meta name="color-scheme" content="light dark">
<style>${CSS}</style></head>
<body>
<a class="skip" href="#start">Skip to start-here panel</a>
<header class="top">
<h1>PortDoctor <span>QNX 8.0 porting report for</span> ${esc(res.root)}</h1>
<p class="sub">portdoctor ${esc(res.version)} &middot; ${s.filesScanned} files scanned (${Object.entries(s.filesByKind).map(([k, v]) => `${v} ${esc(k)}`).join(', ') || 'none'}) &middot; ${s.rules} rules</p>
<details class="banner"><summary><strong>Static analysis only:</strong> nothing here was compiled or run on QNX. <span class="note">Details</span></summary>
<p>${esc(res.disclaimer)}</p><p>Effort figures are rough, uncalibrated ranges derived from rule groups, not measurements. A clean scan is not proof of portability.${s.build.source !== 'none' ? ` Build awareness (heuristic): ${esc(s.build.note)}.` : ''}</p></details>
<p style="margin:.7rem 0 0"><button class="btn" id="themebtn" type="button" aria-label="Toggle light and dark theme">Theme (t)</button> <button class="btn" id="helpbtn" type="button">Keyboard shortcuts (?)</button></p>
</header>
<main id="main">
<h2>Summary</h2>
<div class="cards" role="list">
${SEVERITIES.map((v) => `<div class="card sev-${v}" role="listitem"><div class="n">${s.bySeverity[v]}</div><div class="l"><span aria-hidden="true">${SEV_GLYPH[v]}</span> ${v}: ${esc(SEV_HELP[v])}</div></div>`).join('\n')}
<div class="card" role="listitem"><div class="n">${groups.length}</div><div class="l">rule groups (findings grouped by the rule that found them)</div></div>
<div class="card" role="listitem"><div class="n" style="font-size:1.25rem">${esc(effortHead(total))}</div><div class="l">rough effort, uncalibrated: scaled by groups, not by lines</div></div>
<div class="card" role="listitem"><div class="n">${confKnown}/${s.findings}</div><div class="l">findings from rules marked <em>known</em>; the rest are <em>guess</em></div></div>
<div class="card" role="listitem"><div class="n">${s.suppressedQnxBranch}</div><div class="l">matches suppressed inside <code>#if __QNXNTO__</code> branches</div></div>
</div>
<h2 id="start">Start here: top ${top.length || 3}</h2>
${startHtml}
<h2>Where the work is <span class="meta">(${byFileTiles ? 'by file, few directories' : 'by directory'}${byFileTiles && tiles.length === 24 ? ', top 24' : ''})</span></h2>
${heat}
<h2 id="findings">Findings by rule group</h2>
<div class="bar" role="search" aria-label="Filter findings">
<input id="q" type="search" placeholder="Search file, rule, text ( / )" aria-label="Search findings">
${SEVERITIES.map((v, i) => `<button type="button" class="chip" data-sevbtn="${v}" aria-pressed="true" title="Toggle ${v} (${i + 1})"><span aria-hidden="true">${SEV_GLYPH[v]}</span> ${v} <span class="sr">toggle</span>(${s.bySeverity[v]})</button>`).join('\n')}
<label class="note">Confidence <select id="conf" aria-label="Confidence filter"><option value="all">all</option><option value="known">known</option><option value="guess">guess</option></select></label>
<label class="note"><input type="checkbox" id="guard" checked> include Linux-guarded</label>
${s.build.findingsNotInBuildList ? `<label class="note"><input type="checkbox" id="unbuilt" checked> include files not in build list (${s.build.findingsNotInBuildList})</label>` : ''}
<button class="btn" id="expand" type="button">Expand all groups</button>
<button class="btn" id="clear" type="button">Reset filters</button>
<span id="count" role="status" aria-live="polite">${s.findings} findings</span>
</div>
${groupsHtml || '<p class="empty show">No porting blockers found by the current rules. That is not proof the code ports.</p>'}
<p class="empty">No findings match the current filters.</p>
<footer><p>What this report does not claim: that anything here compiled or ran on QNX; that a missing finding means the code ports; that 'guess' rules are true. Remedies name public QNX/POSIX interfaces from documentation the authors recall; confirm each against your SDP.</p></footer>
</main>
<dialog id="help" aria-labelledby="help-t"><h2 id="help-t" style="margin-top:0">Keyboard shortcuts</h2>
<p><kbd>/</kbd> search &nbsp; <kbd>j</kbd> / <kbd>k</kbd> next / previous finding &nbsp; <kbd>1</kbd>&ndash;<kbd>4</kbd> toggle blocker, major, minor, info &nbsp; <kbd>t</kbd> theme &nbsp; <kbd>Esc</kbd> close this dialog, leave search or clear the tile filter &nbsp; <kbd>?</kbd> this help</p>
<form method="dialog"><button class="btn">Close</button></form></dialog>
<script type="application/json" id="pd-data">${data}</script>
<script>${JS}</script>
</body></html>
`;
}

function firstSentence(t: string): string {
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  const r = m ? m[1] : t;
  return r.length > 220 ? r.slice(0, 217) + '...' : r;
}
