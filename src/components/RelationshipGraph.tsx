import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan, ChevronDown, ChevronRight, GripVertical, Grid3x3, LayoutGrid } from 'lucide-react';
import { contractView, price, type Position, type Relation, type GroupOffset } from '../domain/engine';
import { contractGroup, contractStatus, type ContractGrouping } from './portfolioModel';

export type Move = { dx: number; dy: number };
export type Moves = Record<string, Move>;
const NODE_W = 220, NODE_H = 64, PAD = 12;
const CLUSTER_W = PAD + NODE_W + PAD;
/** Rows a container runs to before its contracts wrap into another column. A
 *  38-contract container in one column is 2,500px tall, and one container that
 *  tall pins the whole canvas to a zoom nothing can be read at. */
const ROW_CAP = 12, MAX_NODE_COLS = 4;
/** Above this many edges on the canvas, only the focused ones get a hit area. */
const CLICKABLE_EDGES = 250;
const GRID = 16;
const NO_MOVE: Move = { dx: 0, dy: 0 };

/** One edge's curve, from the two node corners it joins. */
const edgePath = (ax:number, ay:number, bx:number, by:number) => {
  const right=bx>=ax;const sx=ax+(right?NODE_W:0);const ex=bx+(right?0:NODE_W);const sy=ay+27,ey=by+27;
  const bend=Math.abs(ex-sx)<40?Math.max(sx,ex)+40:(sx+ex)/2;
  return `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ey}, ${ex} ${ey}`;
};
const MIN_ZOOM = .3, MAX_ZOOM = 2;

/**
 * The relationship canvas.
 *
 * Pan and zoom are a transform on the stage rather than scroll on a container.
 * That is what lets a container be dragged anywhere, including above and to the
 * left of where the computed arrangement put it: a scroll container cannot hold
 * negative coordinates, so it pins the top-left container in place.
 */
export function RelationshipGraph({ids, positions, relations, focusIds, selectedRelation, exactGroups, grouping, moves, onMove, onMoves, onSelect, onRelation, onGroup, onBackground}: {
  ids: string[]; positions: Position[]; relations: Relation[]; focusIds: string[]; selectedRelation: Relation | null;
  exactGroups: GroupOffset[]; grouping: ContractGrouping;
  moves: Moves; onMove: (name:string, move:Move)=>void; onMoves: (next:Moves)=>void;
  onSelect: (id:string, additive:boolean)=>void; onRelation:(r:Relation)=>void; onGroup:(id:string)=>void; onBackground:()=>void;
}) {
  const viewport = useRef<HTMLDivElement>(null);const stage = useRef<HTMLDivElement>(null);const lines = useRef<SVGSVGElement>(null);
  const [zoom,setZoom]=useState(1);const zoomRef=useRef(1);const [view,setView]=useState({x:0,y:0});const [framed,setFramed]=useState(false);
  const viewRef=useRef(view);
  const pan=useRef<{x:number;y:number;vx:number;vy:number;moved:boolean}|null>(null);const [panning,setPanning]=useState(false);
  const drag=useRef<{
    name:string;x:number;y:number;from:Move;to?:Move;
    /** The container's own element, and the edges with an end inside it. */
    el:HTMLElement;
    edges:{el:Element;a:{x:number;y:number};b:{x:number;y:number};am:boolean;bm:boolean}[];
    /** True when the canvas is dense enough to draw simplified while moving. */
    simple:boolean;
  }|null>(null);const [dragging,setDragging]=useState<string|null>(null);
  const [front,setFront]=useState<string|null>(null);
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  /** The panel's own size, which the arrangement is shaped against. */
  const [panel,setPanel]=useState({w:960,h:560});

  // The computed arrangement, before anybody moves anything.
  const base = useMemo(()=>{
    const families = new Map<string,string[]>();ids.forEach(id=>{const family=contractGroup(id,grouping);families.set(family,[...(families.get(family)??[]),id]);});
    const sized=[...families].map(([name,groupIds])=>{
      const folded=collapsed.has(name);
      const cols=folded?1:Math.max(1,Math.min(MAX_NODE_COLS,Math.ceil(groupIds.length/ROW_CAP)));
      const rows=Math.ceil(groupIds.length/cols);
      return {name,ids:groupIds,rows,folded,width:PAD+cols*(NODE_W+PAD),height:folded?42:42+rows*NODE_H+8};
    });

    // How wide to run before starting a new shelf.
    //
    // The canvas is fitted by zooming, so the arrangement that shows the most
    // is the one whose shape matches the panel's: too narrow and it fits on
    // width while running off the bottom, too wide and the reverse. Derived
    // from the panel rather than fixed, so widening the panel spreads the
    // containers out instead of leaving the same tall strip in more space.
    const area=sized.reduce((sum,g)=>sum+(g.width+22)*(g.height+22),0);
    const target=Math.max(...sized.map(g=>g.width), Math.sqrt(area*Math.max(.6,panel.w/Math.max(1,panel.h))));

    // Shelf packing, because containers no longer share one width: a large
    // container wraps its contracts into several columns, and a fixed column
    // pitch would then leave a small one sitting in a wide gap.
    let x=14, y=14, shelf=0;
    return sized.map(g=>{
      if(x>14&&x+g.width>target){x=14;y+=shelf+22;shelf=0;}
      const placed={...g,x,y};
      x+=g.width+22;shelf=Math.max(shelf,g.height);
      return placed;
    });
  },[ids,collapsed,grouping,panel]);

  // Where everything sits now. Coordinates are free to be negative.
  const layout = useMemo(()=>{
    const groups=base.map(g=>{const m=moves[g.name]??NO_MOVE;return {...g,x:g.x+m.dx,y:g.y+m.dy};});
    const nodes=new Map<string,{x:number;y:number}>();
    // Column-major inside a container, so contracts still read top to bottom.
    groups.forEach(g=>{if(!g.folded)g.ids.forEach((id,i)=>nodes.set(id,{x:g.x+PAD+Math.floor(i/g.rows)*(NODE_W+PAD),y:g.y+38+(i%g.rows)*NODE_H}));});
    const minX=Math.min(0,...groups.map(g=>g.x)),minY=Math.min(0,...groups.map(g=>g.y));
    const maxX=Math.max(CLUSTER_W,...groups.map(g=>g.x+g.width)),maxY=Math.max(1,...groups.map(g=>g.y+g.height));
    return {groups,nodes,minX,minY,width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY)};
  },[base,moves]);

  /** Frame the whole canvas, wherever things have been dragged to. */
  const frame = (node: HTMLDivElement, l: typeof layout) => {
    const z=Math.max(MIN_ZOOM,Math.min(1,(node.clientWidth-32)/l.width,(node.clientHeight-32)/l.height));
    zoomRef.current=z;setZoom(z);
    setView({x:(node.clientWidth-l.width*z)/2-l.minX*z, y:(node.clientHeight-l.height*z)/2-l.minY*z});
  };
  const fit = () => {if(viewport.current)frame(viewport.current,layout);};

  // Frame on open, when the filters change the cast of contracts, and when the
  // panel is resized -- never while the user is arranging.
  useEffect(()=>{setFramed(false);},[base]);
  useEffect(()=>{const node=viewport.current;if(!node||framed)return;frame(node,layout);setFramed(true);},[framed,layout]);
  useEffect(()=>{const node=viewport.current;if(!node)return;
    const observer=new ResizeObserver(()=>{setFramed(false);setPanel(p=>p.w===node.clientWidth&&p.h===node.clientHeight?p:{w:node.clientWidth,h:node.clientHeight});});
    observer.observe(node);return()=>observer.disconnect();},[]);

  /**
   * Move the canvas without telling React.
   *
   * At universe scope the stage holds 122 containers and a four-figure number
   * of paths. Re-rendering that on every pointer move is what makes a gesture
   * feel heavy, and none of it changes while the canvas is only being moved or
   * scaled -- so a pan or a pinch writes the transform straight to the node and
   * commits to state once the gesture settles. The layout effect re-applies the
   * committed values after any render, so the two can never disagree.
   */
  const applyView=(x:number,y:number)=>{
    viewRef.current={x,y};
    const z=zoomRef.current;
    if(stage.current)stage.current.style.transform=`translate(${x}px, ${y}px) scale(${z})`;
    if(viewport.current){
      viewport.current.style.backgroundPosition=`${x}px ${y}px`;
      viewport.current.style.backgroundSize=`${GRID*z}px ${GRID*z}px`;
    }
  };
  useLayoutEffect(()=>{zoomRef.current=zoom;applyView(view.x,view.y);});

  /** Hand the gesture's result back to React once it stops arriving. */
  const settle=useRef<number|undefined>(undefined);
  const commit=(delay=160)=>{
    window.clearTimeout(settle.current);
    settle.current=window.setTimeout(()=>{setView(viewRef.current);setZoom(zoomRef.current);},delay);
  };
  useEffect(()=>()=>window.clearTimeout(settle.current),[]);

  /** Zoom about a point in the viewport, so that point stays under the cursor. */
  const zoomAt = (px:number, py:number, factor:number, delay?:number) => {
    const from=zoomRef.current;
    const next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,from*factor));
    if(next===from)return;
    // Held in a ref: a pinch fires many wheel events per frame, and React has
    // not re-rendered between them. Reading state here would compound them all
    // off the same stale zoom and lose most of the gesture.
    zoomRef.current=next;
    const v=viewRef.current;
    applyView(px-(px-v.x)*(next/from), py-(py-v.y)*(next/from));
    commit(delay);
  };

  /** Zoom about the middle of the viewport, so the canvas does not jump. */
  const zoomTo = (next:number) => {
    const node=viewport.current;if(!node)return;
    zoomAt(node.clientWidth/2, node.clientHeight/2, next/zoomRef.current, 0);
  };

  // Pinch and wheel.
  //
  // A trackpad pinch reaches the page as a wheel event with ctrlKey set and a
  // delta proportional to the gesture, so the zoom factor has to be continuous
  // in that delta -- a fixed step per event is what makes it feel notched. The
  // listener is native and non-passive because React registers wheel handlers
  // passively, and without preventDefault the browser zooms the whole page
  // underneath the canvas.
  useEffect(()=>{
    const node=viewport.current;if(!node)return;
    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();
      const scale=e.deltaMode===1?16:e.deltaMode===2?node.clientHeight:1;
      if(e.ctrlKey||e.metaKey){
        const delta=Math.max(-60,Math.min(60,e.deltaY*scale));
        const rect=node.getBoundingClientRect();
        zoomAt(e.clientX-rect.left, e.clientY-rect.top, Math.exp(-delta/180));
      } else {
        const v=viewRef.current;
        applyView(v.x-e.deltaX*scale, v.y-e.deltaY*scale);
        commit();
      }
    };
    node.addEventListener('wheel',onWheel,{passive:false});
    return ()=>node.removeEventListener('wheel',onWheel);
  },[]);

  const moveBy=(name:string,dx:number,dy:number)=>{const from=moves[name]??NO_MOVE;setFront(name);onMove(name,{dx:from.dx+dx,dy:from.dy+dy});};
  /** Line every container up on the dot grid it already sits on. */
  const snap=()=>{const next:Moves={};base.forEach(g=>{const m=moves[g.name]??NO_MOVE;
    next[g.name]={dx:Math.round((g.x+m.dx)/GRID)*GRID-g.x, dy:Math.round((g.y+m.dy)/GRID)*GRID-g.y};});onMoves(next);};

  // Every relation between two contracts on the canvas, not only the ones
  // touching a selection. Which relations exist at all is the relation-type
  // filter's job; selection only decides what is emphasised.
  const edges=useMemo(()=>relations.filter(r=>layout.nodes.has(r.a)&&layout.nodes.has(r.b)),[relations,layout]);
  const selectedKey=selectedRelation?`${selectedRelation.a}:${selectedRelation.b}`:'';
  const related=new Set([...focusIds,...edges.filter(r=>focusIds.includes(r.a)||focusIds.includes(r.b)).flatMap(r=>[r.a,r.b])]);
  const held=new Map<string,Position[]>();positions.forEach(p=>held.set(p.contract_id,[...(held.get(p.contract_id)??[]),p]));
  const pad=80, box={x:layout.minX-pad,y:layout.minY-pad,w:layout.width+pad*2,h:layout.height+pad*2};

  // The base layer: every edge on the canvas, drawn once.
  //
  // Deliberately independent of the selection. Marking each edge dimmed or lit
  // individually meant a thousand className rewrites and a style recalc per
  // contract clicked; instead the whole layer is dimmed by one attribute on its
  // group, and the edges under the selection are redrawn bright on top of it.
  // React sees the same element objects and skips the subtree entirely.
  //
  // A second, fat, invisible path per edge is what makes a hairline clickable.
  // Worth it for a readable number of edges; at universe scope it doubles a
  // four-figure element count to buy a click on a line one pixel wide, which
  // nobody aims for among a thousand of them. Above the threshold only the lit
  // overlay carries hit areas -- the edges actually being read.
  const hitAll=edges.length<=CLICKABLE_EDGES;
  const drawEdge=(r:Relation,i:number,extra:string,hit:boolean)=>{
    const a=layout.nodes.get(r.a)!;const b=layout.nodes.get(r.b)!;
    const path=edgePath(a.x,a.y,b.x,b.y);
    return <g key={`${r.a}:${r.b}`} data-edge={i} className={`graph-edge ${r.kind.toLowerCase()}${extra}`}>
      <path d={path} markerEnd={r.kind==='IMPLICATION'?'url(#relation-arrow)':undefined}/>
      {hit&&<path d={path} className="edge-hit" onClick={()=>onRelation(r)}/>}
    </g>;
  };
  const baseEdges=useMemo(()=>edges.map((r,i)=>drawEdge(r,i,'',hitAll)),[edges,layout,hitAll,onRelation]);

  // The selection, drawn over the dimmed layer. Only this rebuilds on a click.
  const litEdges=useMemo(()=>focusIds.length===0?null:
    edges.map((r,i)=>({r,i})).filter(({r})=>focusIds.includes(r.a)||focusIds.includes(r.b))
      .map(({r,i})=>drawEdge(r,i,`${`${r.a}:${r.b}`===selectedKey?' selected':''}`,true)),
    [edges,layout,focusIds,selectedKey,onRelation]);

  const node=(id:string,col:number,row:number)=>{const v=contractView(id);const holding=held.get(id);const selected=focusIds.includes(id);const status=contractStatus(id);
    return <button key={id} className={`contract-node ${selected?'selected':''} ${holding?'held':''} ${status.flag?'inert':''} ${focusIds.length&&!related.has(id)?'subdued':''}`} style={{left:PAD+col*(NODE_W+PAD),top:38+row*NODE_H}} aria-pressed={selected} title={status.flag?`${v.contract.question}\n\n${status.reason}`:v.contract.question} onClick={e=>onSelect(id,e.shiftKey||e.metaKey||e.ctrlKey)}><span className="node-title">{v.authored.shortName}</span><strong className="node-price">{v.contract.marks.last_trade_price===null?'—':price(Math.round(v.contract.marks.last_trade_price*10000))}<small>YES</small></strong><span className="node-sub">{holding?holding.map(h=>`${h.side} ${(h.quantity/1000).toLocaleString()}k`).join(' + '):'NOT HELD'}{status.flag&&<i className="node-flag">{status.flag}</i>}<span>#{id}</span></span></button>;};

  return <div className="graph-area">
    <div className={`graph-viewport ${panning?'panning':''}`} ref={viewport} tabIndex={0} aria-label="Contract graph canvas"
      style={{backgroundPosition:`${view.x}px ${view.y}px`,backgroundSize:`${GRID*zoom}px ${GRID*zoom}px`}}
      onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button, .cluster-head'))return;pan.current={x:e.clientX,y:e.clientY,vx:viewRef.current.x,vy:viewRef.current.y,moved:false};setPanning(true);e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const s=pan.current;if(!s)return;if(Math.abs(e.clientX-s.x)+Math.abs(e.clientY-s.y)>3)s.moved=true;applyView(s.vx+(e.clientX-s.x),s.vy+(e.clientY-s.y));}}
      onPointerUp={e=>{const s=pan.current;pan.current=null;setPanning(false);e.currentTarget.releasePointerCapture(e.pointerId);
        if(s&&!s.moved)onBackground();else setView(viewRef.current);}}
      onPointerCancel={()=>{pan.current=null;setPanning(false);setView(viewRef.current);}}
      onKeyDown={e=>{if(e.target!==e.currentTarget)return;const step=e.shiftKey?120:40;const by={ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]}[e.key];if(!by)return;setView(v=>({x:v.x+by[0],y:v.y+by[1]}));e.preventDefault();}}>

      <div className="graph-stage" ref={stage} style={{transform:`translate(${view.x}px, ${view.y}px) scale(${zoom})`}}>
        <svg className="graph-lines" ref={lines} style={{left:box.x,top:box.y}} width={box.w} height={box.h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} aria-hidden="true"><defs><marker id="relation-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>
          <g className="edge-base" opacity={focusIds.length?.14:1}>{baseEdges}</g>
          {litEdges&&<g className="edge-lit">{litEdges}</g>}
        </svg>

        {layout.groups.map(g=><div className={`graph-cluster ${dragging===g.name?'dragging':''}`} key={g.name} style={{left:g.x,top:g.y,width:g.width,height:g.height,zIndex:dragging===g.name?5:front===g.name?4:undefined}}>
          <div className="cluster-head"
            onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('.cluster-fold'))return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
              // Everything the drag will touch, resolved once: only this
              // container moves, and only the edges with an end inside it
              // change shape. The rest of the canvas is untouched, so the drag
              // never goes through React until it is dropped.
              const inside=new Set(g.ids);const attached:NonNullable<typeof drag.current>['edges']=[];
              stage.current?.querySelectorAll('g[data-edge]').forEach(el=>{
                const r=edges[Number((el as HTMLElement).dataset.edge)];if(!r)return;
                const am=inside.has(r.a),bm=inside.has(r.b);if(!am&&!bm)return;
                attached.push({el,a:layout.nodes.get(r.a)!,b:layout.nodes.get(r.b)!,am,bm});
              });
              // Moving one edge repaints the whole lines layer, so on a dense
              // canvas the layer sheds its decoration for the duration: dashes
              // and arrowheads each cost several times a plain stroke to
              // rasterise. The curves and the colours stay, and every wire
              // stays attached, which is the point of dragging a container.
              const simple=edges.length>CLICKABLE_EDGES;
              if(simple)lines.current?.classList.add('simplified');
              drag.current={name:g.name,x:e.clientX,y:e.clientY,from:moves[g.name]??NO_MOVE,el:e.currentTarget.parentElement as HTMLElement,edges:attached,simple};
              setDragging(g.name);setFront(g.name);}}
            onPointerMove={e=>{const d=drag.current;if(!d||d.name!==g.name)return;
              const dx=(e.clientX-d.x)/zoomRef.current, dy=(e.clientY-d.y)/zoomRef.current;
              d.el.style.transform=`translate(${dx}px, ${dy}px)`;
              for(const it of d.edges){
                const path=edgePath(it.a.x+(it.am?dx:0),it.a.y+(it.am?dy:0),it.b.x+(it.bm?dx:0),it.b.y+(it.bm?dy:0));
                for(const line of it.el.children)line.setAttribute('d',path);
              }
              d.to={dx:d.from.dx+dx,dy:d.from.dy+dy};}}
            onPointerUp={e=>{const d=drag.current;drag.current=null;setDragging(null);e.currentTarget.releasePointerCapture(e.pointerId);
              // Hand the result to React and drop the temporary offset together:
              // pointerup is a discrete event, so the re-render lands before the
              // next paint and the container never flashes back.
              if(d){
                d.el.style.transform='';lines.current?.classList.remove('simplified');
                const {dx,dy}=d.to?{dx:d.to.dx-d.from.dx,dy:d.to.dy-d.from.dy}:{dx:0,dy:0};
                for(const it of d.edges){
                  const path=edgePath(it.a.x+(it.am?dx:0),it.a.y+(it.am?dy:0),it.b.x+(it.bm?dx:0),it.b.y+(it.bm?dy:0));
                  for(const line of it.el.children)line.setAttribute('d',path);
                }
                if(d.to)onMove(d.name,d.to);
              }}}
            onPointerCancel={()=>{const d=drag.current;drag.current=null;setDragging(null);
              if(d){d.el.style.transform='';lines.current?.classList.remove('simplified');
                for(const it of d.edges){const path=edgePath(it.a.x,it.a.y,it.b.x,it.b.y);for(const line of it.el.children)line.setAttribute('d',path);}}}}>
            <button className="cluster-fold" aria-expanded={!g.folded} aria-label={`${g.folded?'Expand':'Collapse'} ${g.name}`} onClick={()=>{const next=new Set(collapsed);if(next.has(g.name))next.delete(g.name);else next.add(g.name);setCollapsed(next);}}>{g.folded?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button>
            <span className="cluster-name">{g.name}</span>
            <span className="cluster-count">{g.ids.length}</span>
            <button className="cluster-grip" aria-label={`Move ${g.name}`}
              onKeyDown={e=>{const step=e.shiftKey?48:GRID;const by={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!by)return;moveBy(g.name,by[0],by[1]);e.preventDefault();}}><GripVertical size={12}/></button>
          </div>
          {!g.folded&&g.ids.map((id,i)=>node(id,Math.floor(i/g.rows),i%g.rows))}
        </div>)}
      </div>
      {ids.length===0&&<div className="empty-state">No contracts match these filters.</div>}
    </div>

    <div className="graph-bottom"><span>{ids.length} nodes · {edges.length.toLocaleString()} relations drawn</span><div>
      <button className="icon-button" aria-label="Snap containers to grid" title="Snap to grid" onClick={snap}><Grid3x3 size={13}/></button>
      <button className="icon-button" aria-label="Auto-arrange containers" title="Auto-arrange" onClick={()=>onMoves({})}><LayoutGrid size={13}/></button>
      <span className="toolbar-rule" />
      <button className="icon-button" aria-label="Zoom out" disabled={zoom<=MIN_ZOOM} onClick={()=>zoomTo(Math.max(MIN_ZOOM,zoom-.1))}><Minus size={13}/></button><span className="mono">{Math.round(zoom*100)}%</span><button className="icon-button" aria-label="Zoom in" disabled={zoom>=MAX_ZOOM} onClick={()=>zoomTo(Math.min(MAX_ZOOM,zoom+.1))}><Plus size={13}/></button><button className="icon-button" aria-label="Fit graph" onClick={fit}><Scan size={14}/></button>
    </div></div>
    {exactGroups.length>0&&<div className="exact-group-strip"><span className="section-label">EXACT GROUP OFFSETS</span>{exactGroups.map(g=><button key={g.eventId} onClick={()=>onGroup(g.eventId)}><span className="exact-bracket">[ {g.positions.length} LEGS ]</span><span>{contractView(g.positions[0].contract_id).event.title}</span><b>{(g.constantPayoutCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})} payout</b><ChevronRight size={13}/></button>)}</div>}
  </div>;
}
