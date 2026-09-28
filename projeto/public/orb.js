// Nebula-like shader orb for the existing vanilla-JS web app.
// The supplied React registry import is not part of this repository; this
// WebGL implementation has no network or framework dependency.
export function createGriotOrb(canvas, fallback, halo) {
  let gl;
  try { gl = canvas.getContext('webgl', { alpha:true, antialias:true, premultipliedAlpha:false, powerPreference:'low-power' }); } catch {}
  if (!gl) {
    canvas.hidden = true;
    fallback.hidden = false;
    return { setMode(){}, setLevel(){}, destroy(){} };
  }
  const vertex = `attribute vec2 aPos; varying vec2 vUv; void main(){vUv=aPos;gl_Position=vec4(aPos,0.,1.);}`;
  const fragment = `
    precision mediump float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uLevel;
    uniform float uMode;
    uniform float uAspect;
    const float PI = 3.14159265359;
    float gauss(float x, float width){float v=x/width; return exp(-v*v);}
    void main(){
      vec2 p = vUv;
      p.x *= uAspect;
      float r=length(p);
      float a=atan(p.y,p.x);
      float pace=mix(.12,mix(.55,1.4,step(1.5,uMode)),step(.5,uMode));
      float t=uTime*pace;
      float energy=uLevel;
      vec3 result=vec3(0.0);
      float total=0.0;
      float center=.59+.045*sin(a*3.0+t*.72)+.03*sin(a*5.0-t*.48);
      for(int i=0;i<9;i++){
        float k=float(i);
        float phase=k*.47;
        float wave=sin(a*3.4+phase*1.3+t*(.75+k*.045))*.036;
        wave+=sin(a*5.1-phase*1.8-t*.65)*.02;
        float ridge=center+(k-4.0)*.019+wave+energy*.065*sin(a*4.0+t*2.0+phase);
        float width=.013+.004*sin(a*2.0+t+phase)+.013*energy;
        float v=gauss(r-ridge,width);
        float flicker=.64+.36*sin(a*2.4+t*.38+phase);
        float amount=v*flicker*.12;
        vec3 violet=vec3(.70,.36,.86);
        vec3 pink=vec3(.91,.60,.91);
        vec3 apricot=vec3(.98,.72,.52);
        vec3 blue=vec3(.57,.78,.99);
        vec3 c=mix(violet,pink,smoothstep(0.0,4.0,k));
        c=mix(c,apricot,smoothstep(4.0,8.0,k)*(.65+.35*sin(a*1.6+t*.28)));
        c=mix(c,blue, .28+.19*sin(a+phase));
        result+=c*amount;
        total+=amount;
      }
      float outerGlow=gauss(r-center,.115)*.075;
      result+=mix(vec3(.77,.56,.89),vec3(.99,.79,.58),.5+.5*sin(a*2.0+t*.15))*outerGlow;
      total+=outerGlow*.42;
      float whiteLines=gauss(r-(center+.014*sin(a*6.0-t*.25)),.004)*.055;
      result+=vec3(1.)*whiteLines;
      total+=whiteLines;
      float mask=1.0-smoothstep(.90,1.0,r);
      float alpha=clamp(total*.93,0.0,.73)*mask;
      vec3 color=total>0.0001?result/total:vec3(.78,.58,.9);
      gl_FragColor=vec4(color,alpha);
    }
  `;
  function compile(kind,source){const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
  let prog;
  try {
    prog=gl.createProgram();
    gl.attachShader(prog,compile(gl.VERTEX_SHADER,vertex));
    gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));
  } catch(err){console.warn('Griot orb WebGL unavailable:',err);canvas.hidden=true;fallback.hidden=false;return {setMode(){},setLevel(){},destroy(){}};}
  gl.useProgram(prog);
  const buffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(prog,'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const U={time:gl.getUniformLocation(prog,'uTime'),level:gl.getUniformLocation(prog,'uLevel'),mode:gl.getUniformLocation(prog,'uMode'),aspect:gl.getUniformLocation(prog,'uAspect')};
  const limited=window.matchMedia('(prefers-reduced-motion: reduce)');
  let mode='idle',desired=0,level=0,raf=0,last=0,time=0,removed=false;
  const MODES={idle:0,listening:1,speaking:2};
  function resize(){
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.8);
    const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(w&&h&&(canvas.width!==w||canvas.height!==h)){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
  }
  function draw(now){
    if(removed)return;
    raf=requestAnimationFrame(draw);
    if(document.hidden)return;
    const fps=limited.matches?8:mode==='speaking'?50:mode==='listening'?27:18;
    if(now-last<1000/fps)return;
    const dt=last?Math.min((now-last)/1000,.1):.016;
    last=now;
    if(!limited.matches)time+=dt;
    level+=(desired-level)*Math.min(1,dt*8);
    desired*=mode==='speaking'?.98:.90;
    resize();
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.time,time);
    gl.uniform1f(U.level,level);
    gl.uniform1f(U.mode,MODES[mode]);
    gl.uniform1f(U.aspect,canvas.width/canvas.height);
    gl.drawArrays(gl.TRIANGLES,0,6);
    halo.style.transform=`scale(${1+level*.09})`;
  }
  function setMode(next){mode=MODES[next]!==undefined?next:'idle'; if(mode!=='speaking')desired=0;}
  function setLevel(value){desired=Math.max(0,Math.min(1,Number(value)||0));}
  function destroy(){removed=true;cancelAnimationFrame(raf);gl.deleteBuffer(buffer);gl.deleteProgram(prog);}
  raf=requestAnimationFrame(draw);
  return {setMode,setLevel,destroy};
}
