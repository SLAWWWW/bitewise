"""Deterministic, text-led Lumbung product film. No narration or external render service.

Render: python render.py --output Lumbung-Core-Features-60s.mp4
Inspect: python render.py --stills
All times are authored video seconds; frames are evaluated independently.
"""
from __future__ import annotations

import argparse
import functools
import json
import math
from pathlib import Path
import subprocess
import time
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
PREVIEWS = ROOT / "previews"
W, H, FPS, DURATION = 1920, 1080, 30, 60
WHITE, MUTED, DIM, LINE = (248,)*3, (163,)*3, (104,)*3, (57,)*3
TIMELINE = json.loads((ROOT / "timeline.json").read_text())
TEXT_BOUNDS: list[dict] = []
RECORD_BOUNDS = False


def clamp(x):
    return max(0.0, min(1.0, x))


def ease(x):
    x = clamp(x)
    return 1 - (1-x)**3


def smooth(x):
    x = clamp(x)
    return x*x*(3-2*x)


def lerp(a, b, x):
    return a+(b-a)*x


def gray(v):
    return (round(v),)*3


@functools.lru_cache(maxsize=160)
def font(size, weight="Regular"):
    return ImageFont.truetype(str(ASSETS / f"Geist-{weight}.ttf"), round(size))


@functools.lru_cache(maxsize=256)
def text_sprite(value, size, weight="Regular", color=WHITE):
    face = font(size, weight)
    bounds = face.getbbox(value)
    image = Image.new("RGBA", (max(1, bounds[2]-bounds[0]+6), bounds[3]-bounds[1]+6))
    ImageDraw.Draw(image).text((3-bounds[0], 3-bounds[1]), value, font=face, fill=(*color, 255))
    return image


def text(image, value, x, y, size=40, color=WHITE, weight="Regular", anchor="left", opacity=1):
    if opacity <= 0:
        return
    sprite = text_sprite(value, size, weight, tuple(color))
    if anchor == "center":
        x -= sprite.width/2
    elif anchor == "right":
        x -= sprite.width
    if opacity < 1:
        sprite = sprite.copy()
        sprite.putalpha(sprite.getchannel("A").point(lambda a: round(a*clamp(opacity))))
    image.alpha_composite(sprite, (round(x), round(y)))
    if RECORD_BOUNDS and opacity > .9:
        TEXT_BOUNDS.append({"text": value, "bounds": [x, y, x+sprite.width, y+sprite.height]})


def lines(image, values, x, y, size=86, gap=18, color=WHITE, weight="Medium", alpha=1):
    for i, value in enumerate(values):
        text(image, value, x, y+i*(size+gap), size, color, weight, opacity=alpha)


@functools.lru_cache(maxsize=60)
def icon_asset(name, size=72, dark=False):
    source = Image.open(ASSETS / f"{name}-{'black' if dark else 'white'}.png").convert("RGBA")
    return source.resize((round(size), round(size)), Image.Resampling.LANCZOS)


def icon(image, name, x, y, size=72, opacity=1, dark=False):
    source = icon_asset(name, size, dark)
    if opacity < 1:
        source = source.copy()
        source.putalpha(source.getchannel("A").point(lambda a: round(a*clamp(opacity))))
    image.alpha_composite(source, (round(x-size/2), round(y-size/2)))


@functools.lru_cache(maxsize=32)
def light_sprite(radius, brightness=70):
    side = radius*4
    canvas = Image.new("RGBA", (side, side))
    ImageDraw.Draw(canvas).ellipse((radius, radius, radius*3, radius*3), fill=(255,255,255,brightness))
    return canvas.filter(ImageFilter.GaussianBlur(radius*.6))


def glow(image, x, y, radius=100, strength=35):
    asset = light_sprite(radius, strength)
    image.alpha_composite(asset, (round(x-asset.width/2), round(y-asset.height/2)))


@functools.lru_cache(maxsize=6)
def background(kind="dark"):
    rng = np.random.default_rng(261104)
    yy, xx = np.mgrid[:H, :W]
    radial = np.exp(-(((xx-W*.54)/(W*.45))**2 + ((yy-H*.43)/(H*.66))**2)*2)
    values = 6+radial*12+rng.normal(0,.45,(H,W))
    array = np.repeat(np.clip(values,0,255).astype(np.uint8)[:,:,None],3,axis=2)
    result = Image.fromarray(array).convert("RGBA")
    draw = ImageDraw.Draw(result)
    if kind == "grid":
        for x in range(0,W,64):
            for y in range(0,H,64):
                draw.ellipse((x,y,x+1,y+1),fill=(42,42,42))
    return result


def base(kind="dark"):
    return background(kind).copy()


def panel(image, box, radius=24, fill=(18,18,18), outline=LINE, width=2):
    ImageDraw.Draw(image).rounded_rectangle(tuple(round(v) for v in box), radius, fill, outline, width)


def rule(image, points, color=LINE, width=3):
    ImageDraw.Draw(image).line([(round(x),round(y)) for x,y in points], fill=color, width=width, joint="curve")


def path_points(points, count=80):
    a,b,c,d = [np.array(p, dtype=float) for p in points]
    s=np.linspace(0,1,count)[:,None]
    return (1-s)**3*a+3*(1-s)**2*s*b+3*(1-s)*s*s*c+s**3*d


def curve(image, points, amount=1, color=LINE, width=3):
    points=path_points(points)
    n=max(2,math.ceil(len(points)*clamp(amount)))
    if amount>0:
        rule(image, points[:n], color, width)
    return points


def packet(image, points, progress, size=9):
    p=points[min(len(points)-1,round(clamp(progress)*(len(points)-1)))]
    glow(image,p[0],p[1],24,38)
    ImageDraw.Draw(image).ellipse((p[0]-size,p[1]-size,p[0]+size,p[1]+size),fill=WHITE)


def label(image, value, x=112, y=95, alpha=1):
    text(image, value.upper(), x,y,26,MUTED,"Medium",opacity=alpha)


def token(image,x,y,number="10",radius=72,active=True):
    if active:
        glow(image,x,y,round(radius*.9),36)
    d=ImageDraw.Draw(image)
    d.ellipse((x-radius-9,y-radius-9,x+radius+9,y+radius+9),outline=gray(74 if active else 36),width=2)
    d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=(244,)*3 if active else (20,)*3,outline=gray(255 if active else 72),width=2)
    text(image,number,x,y-radius*.39,round(radius*.8),(12,)*3 if active else WHITE,"Medium","center")


def chip(image,value,x,y,active=False,size=26):
    sprite=text_sprite(value,size,"Medium",(16,)*3 if active else WHITE)
    box=(x,y,x+sprite.width+44,y+size+28)
    panel(image,box,round((size+28)/2),(241,)*3 if active else (24,)*3,gray(242 if active else 62))
    text(image,value,x+22,y+12,size,(16,)*3 if active else WHITE,"Medium")
    return box


@functools.lru_cache(maxsize=24)
def screenshot(name,width,crop=None):
    source=Image.open(ASSETS/name).convert("RGB")
    if crop:
        source=source.crop(crop)
    source=ImageOps.grayscale(source).convert("RGBA")
    return source.resize((round(width),round(width*source.height/source.width)),Image.Resampling.LANCZOS)


def screen(image,name,x,y,width,title,crop=None):
    source=screenshot(name,width-4,crop)
    height=source.height+66
    panel(image,(x,y,x+width,y+height),20,(23,)*3,(95,)*3)
    mask=Image.new("L",(width-4,source.height),0)
    ImageDraw.Draw(mask).rounded_rectangle((0,-24,width-5,source.height-1),18,fill=255)
    source=source.copy()
    source.putalpha(mask)
    image.alpha_composite(source,(round(x+2),round(y+64)))
    text(image,title,x+24,y+22,23,MUTED)
    text(image,"DEMO",x+width-24,y+22,21,MUTED,"Medium","right")
    return (x,y,width,height)


def orbit(image,t,cx,cy,radius=280,opacity=1):
    # Abstract routing lattice, not a geographic map or operational coverage claim.
    draw=ImageDraw.Draw(image)
    for band in range(7):
        tilt=math.pi*band/7
        points=[]
        for a in np.linspace(0,2*math.pi,145):
            x=math.cos(a)*radius
            z=math.sin(a)*radius
            y=z*math.sin(tilt)
            z=z*math.cos(tilt)
            turn=t*.18
            rx=x*math.cos(turn)+z*math.sin(turn)
            rz=-x*math.sin(turn)+z*math.cos(turn)
            scale=800/(800+rz)
            points.append((cx+rx*scale,cy+y*scale,rz))
        for j in range(len(points)-1):
            p,q=points[j],points[j+1]
            lum=(38+max(0,-p[2])/radius*65)*opacity
            draw.line((p[0],p[1],q[0],q[1]),fill=gray(lum),width=2)
        k=int((t*.11+band*.137)%1*(len(points)-1))
        p=points[k]
        draw.ellipse((p[0]-4,p[1]-4,p[0]+4,p[1]+4),fill=gray(200*opacity))


def hook(t):
    image=base("grid")
    label(image,"One donation. A real decision.",alpha=ease(t/.35))
    statements=[("10 portions.",.12), ("3 recipients.",1.35), ("One decision.",2.7)]
    for i,(value,start) in enumerate(statements):
        p=ease((t-start)/.55)
        text(image,value,112,245+i*145+35*(1-p),110,WHITE if i==2 else gray(180),"Medium",opacity=p)
    cx,cy=1410,520
    orbit(image,t,cx,cy,250,.7)
    for i,(x,y) in enumerate([(1240,260),(1680,500),(1280,790)]):
        p=ease((t-.8-i*.35)/.55)
        if p:
            path=curve(image,[(cx,cy),(cx+(x-cx)*.5,cy),(x,y-35),(x,y)],p,color=gray(65),width=3)
            packet(image,path,(t*.3+i*.3)%1,5)
            panel(image,(x-45,y-45,x+45,y+45),18,outline=gray(100*p))
            text(image,chr(65+i),x,y-21,42,WHITE,"Medium","center",opacity=p)
    token(image,cx,cy,radius=96)
    text(image,"ILLUSTRATIVE DONATION",112,950,23,DIM)
    return image


def brand(t):
    image=base()
    orbit(image,t+4,960,480,385,.55)
    glow(image,960,490,250,18)
    p=ease(t/.65)
    text(image,"Meet",960,335+30*(1-p),48,MUTED,"Regular","center",p)
    text(image,"lumbung.",960,435,168,WHITE,"Bold","center",p)
    text(image,"Food redistribution. Connected.",960,675,42,MUTED,"Regular","center",ease((t-.65)/.5))
    return image


def intake(t):
    image=base("grid")
    label(image,"01 / Capture the donation")
    p=ease(t/.5)
    lines(image,["Start with", "the essentials."],112,182,95,14,alpha=p)
    text(image,"One clear starting point.",116,435,37,MUTED,opacity=ease((t-.35)/.45))
    # A real source screenshot; motion shifts the frame, never redraws its UI.
    x,y=600+100*(1-p),530+20*(1-p)
    box=screen(image,"intake-screen.png",x,y,1190,"lumbung / new donation")
    steps=[("Food",0.65), ("Quantity",2.0), ("Collection window",3.4)]
    for i,(value,start) in enumerate(steps):
        q=ease((t-start)/.45)
        if q:
            icon(image,["Package","Layers3","Clock3"][i],145,570+i*113,40,q)
            text(image,value,188,548+i*113,32,WHITE,"Medium",opacity=q)
    # Spotlight the actual fields in sequence; outside the photograph only.
    if t>1:
        points=[(600,112,278,44),(893,112,278,44),(17,286,278,44)]
        index=min(2,int((t-1)/1.5))
        sx,sy,sw,sh=points[index]
        scale=(box[2]-4)/1200
        rect=(x+2+sx*scale,y+64+sy*scale,x+2+(sx+sw)*scale,y+64+(sy+sh)*scale)
        ImageDraw.Draw(image).rounded_rectangle(rect,10,outline=(25,)*3,width=4)
    return image


def eligibility(t):
    image=base()
    label(image,"02 / Check the fit")
    text(image,"Nearby isn't enough.",960,165,100,WHITE,"Medium","center")
    text(image,"Safety. Eligibility. Available capacity.",960,300,36,MUTED,"Regular","center")
    token(image,960,466,radius=64)
    xs=[380,960,1540]
    resolved=t>=3.35
    for i,x in enumerate(xs):
        p=ease((t-.5-i*.2)/.6)
        if not p:
            continue
        path=curve(image,[(960,540),(960,600),(x,595),(x,654)],p,gray(115 if i==1 and resolved else 52),4)
        if not resolved:
            packet(image,path,(t*.55+i*.25)%1,6)
        active=resolved and i==1
        fill=(238,)*3 if active else (18,)*3
        panel(image,(x-220,654,x+220,878),24,fill,gray(245 if active else 68),2)
        col=(16,)*3 if active else WHITE
        text(image,f"Recipient {chr(65+i)}",x,690,38,col,"Medium","center")
        details=["Nearby · 0 capacity","Eligible · room for 10","Agreement expired"]
        text(image,details[i],x,754,28,col if active else MUTED,"Regular","center")
        if resolved:
            icon(image,"Check" if active else "X",x-100,835,30,dark=active)
            text(image,"Suggested" if active else "Excluded",x+14,817,27,col if active else MUTED,"Medium","center")
    if resolved:
        packet(image,path_points([(960,540),(960,600),(960,595),(960,654)]),smooth((t-3.35)/1.1),11)
    text(image,"ILLUSTRATIVE DEMO · ELIGIBILITY BEFORE ALLOCATION",960,970,23,DIM,"Regular","center")
    return image


def matching(t):
    image=base("grid")
    label(image,"03 / Explain the recommendation")
    lines(image,["See the match.","Understand the why."],112,185,90,16)
    p=ease(t/.65)
    x=745+70*(1-p)
    screen(image,"recommendation.webp",x,450+25*(1-p),1060,"lumbung / selected recommendation")
    terms=[("Need",.8),("Logistics",1.7),("Distribution history",2.6)]
    for i,(value,start) in enumerate(terms):
        q=ease((t-start)/.45)
        if q:
            icon(image,"Check",135,596+i*95,28,q)
            text(image,value,170,574+i*95,31,WHITE,"Regular",opacity=q)
    text(image,"Real demo result.",112,910,27,MUTED)
    text(image,"Scores you can inspect.",112,955,27,MUTED)
    return image


def approval(t):
    image=base()
    label(image,"04 / Keep people in control")
    text(image,"People stay in control.",960,180,100,WHITE,"Medium","center")
    path_y=600
    rule(image,[(180,path_y),(1740,path_y)],gray(66),4)
    gate1,gate2=580,1340
    a1=t>=2.25
    a2=t>=6.05
    for i,(x,approved) in enumerate([(gate1,a1),(gate2,a2)]):
        glow(image,x,path_y,105,25 if approved else 10)
        panel(image,(x-95,455,x+95,745),26,(234,)*3 if approved else (21,)*3,gray(245 if approved else 96),3)
        icon(image,"Check" if approved else "Hand",x,path_y,84,dark=approved)
        text(image,["Outreach approval","Delivery approval"][i],x,810,34,WHITE,"Medium","center")
        text(image,"APPROVED" if approved else "AWAITING REVIEW",x,872,24,MUTED,"Medium","center")
    if t<2.25:
        x=lerp(190,gate1-175,ease(t/1.2))
    elif t<4.6:
        x=lerp(gate1-175,960,ease((t-2.25)/1.3))
    elif t<6.05:
        x=lerp(960,gate2-175,ease((t-4.6)/.65))
    else:
        x=lerp(gate2-175,1735,ease((t-6.05)/1.25))
    token(image,x,path_y,radius=48)
    if t>=3.8:
        text(image,"Logistics",960,395,29,MUTED,"Medium","center")
        text(image,"confirmed",960,438,30,WHITE,"Medium","center")
        icon(image,"Check",960,510,36)
    text(image,"The plan moves forward when your team approves.",960,980,30,MUTED,"Regular","center")
    return image


def delivery(t):
    image=base("grid")
    label(image,"05 / Coordinate the hand-off")
    text(image,"Direct or via warehouse.",960,185,96,WHITE,"Medium","center")
    text(image,"One coordinated hand-off.",960,318,36,MUTED,"Regular","center")
    a,b=(270,650),(1640,650)
    direct=curve(image,[a,(700,350),(1250,350),b],1,gray(170),4)
    curve(image,[a,(700,970),(1250,970),b],1,gray(67),3)
    for xy,name,title in [(a,"Package","Donor"),(b,"ClipboardCheck","Recipient")]:
        panel(image,(xy[0]-76,xy[1]-76,xy[0]+76,xy[1]+76),28,(21,)*3,gray(115),2)
        icon(image,name,*xy,70)
        text(image,title,xy[0],xy[1]+112,33,WHITE,"Medium","center")
    chip(image,"DIRECT",875,410,True,23)
    panel(image,(865,817,1055,947),24,(20,)*3,gray(85))
    icon(image,"Warehouse",960,882,64)
    text(image,"Warehouse",960,975,30,MUTED,"Regular","center")
    p=smooth((t-.7)/4.15)
    if p<1:
        at=direct[round(p*(len(direct)-1))]
        token(image,at[0],at[1],radius=44)
    else:
        glow(image,*b,100,40)
        icon(image,"Check",*b,65)
    return image


def evidence(t):
    image=base()
    label(image,"06 / Close the reporting loop")
    lines(image,["Proof completes", "the delivery."],112,184,92,14)
    screen(image,"evidence-screen.png",112,520,1040,"lumbung / reporting obligations",(0,45,1200,560))
    items=[("Receipt recorded","ClipboardCheck",.6),("Evidence collected","FileCheck2",2.0),("Missing report?","Clock3",3.5)]
    for i,(value,ico,start) in enumerate(items):
        q=ease((t-start)/.5)
        if q:
            yy=570+i*145+20*(1-q)
            icon(image,ico,1240,yy,48,q)
            text(image,value,1290,yy-23,34,WHITE,"Medium",opacity=q)
            if i==2:
                text(image,"Follow-up stays visible.",1290,yy+30,28,MUTED,opacity=ease((t-4.4)/.4))
    return image


def audit(t):
    image=base("grid")
    label(image,"07 / Keep the full picture")
    text(image,"One donation.",960,185,103,WHITE,"Medium","center")
    text(image,"A traceable journey.",960,316,103,MUTED,"Medium","center")
    xs=[270,610,950,1290,1630]
    names=["Recorded","Matched","Approved","Delivered","Evidence"]
    icons=["Package","GitBranch","Hand","Truck","FileCheck2"]
    y=680
    for i,x in enumerate(xs):
        active=t>=.4+i*.6
        if i:
            rule(image,[(xs[i-1]+62,y),(x-62,y)],gray(210 if active else 44),4)
            p=clamp((t-(.4+i*.6))/.45)
            if 0<p<1:
                px=lerp(xs[i-1]+62,x-62,p)
                glow(image,px,y,25,40)
                ImageDraw.Draw(image).ellipse((px-7,y-7,px+7,y+7),fill=WHITE)
        ImageDraw.Draw(image).ellipse((x-61,y-61,x+61,y+61),fill=(238,)*3 if active else (19,)*3,outline=gray(241 if active else 70),width=2)
        icon(image,icons[i],x,y,54,dark=active,opacity=1 if active else .5)
        text(image,names[i],x,783,31,WHITE if active else DIM,"Medium","center")
    if t>3.5:
        text(image,"Decisions and evidence. Connected.",960,925,34,MUTED,"Regular","center",ease((t-3.5)/.6))
    return image


def closing(t):
    image=base()
    p=ease(t/.85)
    orbit(image,t+40,960,530,lerp(410,315,p),.48)
    glow(image,960,535,240,18)
    text(image,"lumbung.",960,400+30*(1-p),174,WHITE,"Bold","center",p)
    text(image,"Every hand-off, accounted for.",960,650,46,MUTED,"Regular","center",ease((t-.35)/.5))
    return image


SCENES={"hook":hook,"brand":brand,"intake":intake,"eligibility":eligibility,"matching":matching,"approval":approval,"delivery":delivery,"evidence":evidence,"audit":audit,"close":closing}


def frame_at(t):
    t=min(DURATION-1/FPS,max(0,t))
    scene=next(scene for scene in TIMELINE["scenes"] if scene["start"]<=t<scene["end"])
    return SCENES[scene["id"]](t-scene["start"]).convert("RGB")


def make_music():
    """Original synth composition, deterministic seed; no sampled music or voices."""
    sr=48000
    n=sr*DURATION
    music=np.zeros((n,2),dtype=np.float64)
    rng=np.random.default_rng(261104)

    def add(signal,start,gain=.1,pan=0):
        begin=round(start*sr)
        end=min(n,begin+len(signal))
        if end<=begin or begin<0:
            return
        music[begin:end,0]+=signal[:end-begin]*gain*math.sqrt((1-pan)/2)
        music[begin:end,1]+=signal[:end-begin]*gain*math.sqrt((1+pan)/2)

    def freq(midi):
        return 440*2**((midi-69)/12)

    chords=[[50,57,60,64],[46,53,57,60],[53,60,64,67],[48,55,58,62],[50,57,60,65],[50,57,62,69]]
    # Slow, deliberately arranged harmonic movement rather than a repeated audio loop.
    for section,chord in enumerate(chords):
        length=min(12,DURATION-section*10)
        t=np.arange(round(length*sr))/sr
        env=np.minimum(t/2,1)*np.minimum((length-t)/2.4,1)
        for j,midi in enumerate(chord):
            f=freq(midi)
            pad=(np.sin(2*np.pi*f*t)+.22*np.sin(2*np.pi*f*2.003*t)+.12*np.sin(2*np.pi*f*.998*t))/1.34
            add(pad*env,section*10,.045,(-.45+j*.3))
    beat=60/96
    for k in range(96):
        start=k*beat
        chord=chords[min(5,int(start/10))]
        # Alternating plucks with soft, noise-free transients.
        t=np.arange(round(.7*sr))/sr
        f=freq(chord[k%4]+12)
        env=(1-np.exp(-t*90))*np.exp(-t*7)
        pluck=(np.sin(2*np.pi*f*t)+.3*np.sin(2*np.pi*f*2*t))*env
        add(pluck,start,.055 if 9<start<56 else .022,math.sin(k*.8)*.45)
        if k%2==0 and 5<start<56:
            t=np.arange(round(.23*sr))/sr
            phase=2*np.pi*(43*t+30*.04*(1-np.exp(-t/.04)))
            kick=np.sin(phase)*(1-np.exp(-t*500))*np.exp(-t*20)
            add(kick,start,.09)
    # Motivated confirmation accents at the actual two human gate openings.
    for cue in [31.25,35.05,41.85,53.4]:
        t=np.arange(round(.6*sr))/sr
        signal=(np.sin(2*np.pi*880*t)+.35*np.sin(2*np.pi*1320*t))*(1-np.exp(-t*160))*np.exp(-t*10)
        add(signal,cue,.045)
    for cue in [5,56]:
        t=np.arange(round(.9*sr))/sr
        noise=rng.normal(0,1,len(t))
        filtered=np.convolve(noise,np.ones(31)/31,mode="same")
        add(filtered*np.sin(np.pi*t/.9)**2,cue-.45,.08)
    # Resolve and fade the authored composition, without changing its timing.
    timeline=np.arange(n)/sr
    envelope=np.minimum(timeline/.7,1)*np.minimum((DURATION-timeline)/1.1,1)
    music*=envelope[:,None]
    peak=float(np.max(np.abs(music)))
    music*=.68/max(peak,1e-8)
    path=ROOT/"music-original.wav"
    with wave.open(str(path),"wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes((np.clip(music,-1,1)*32767).astype('<i2').tobytes())
    print(f"Original electronic score: {DURATION}s, stereo, {sr}Hz",flush=True)
    return path


def write_captions():
    def stamp(seconds):
        ms=round(seconds*1000)
        return f"{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}"
    blocks=[]
    for i,scene in enumerate(TIMELINE["scenes"]):
        blocks.append(f"{i+1}\n{stamp(scene['start'])} --> {stamp(scene['end'])}\n"+'\n'.join(scene['text'])+'\n')
    (ROOT/"on-screen-text.srt").write_text('\n'.join(blocks))


def stills():
    global RECORD_BOUNDS
    PREVIEWS.mkdir(exist_ok=True)
    moments=[3.9,7.1,13.5,20.7,26.2,35.9,41.5,48.8,54.5,58.7]
    captures=[]
    all_bounds=[]
    for t in moments:
        TEXT_BOUNDS.clear()
        RECORD_BOUNDS=True
        image=frame_at(t)
        RECORD_BOUNDS=False
        image.save(PREVIEWS/f"frame-{t:04.1f}.png")
        for item in TEXT_BOUNDS:
            x0,y0,x1,y1=item['bounds']
            if not(0<=x0<x1<=W and 0<=y0<y1<=H):
                raise ValueError(f"Out-of-frame text at {t}: {item}")
        all_bounds.append({"time":t,"text":list(TEXT_BOUNDS)})
        thumb=image.resize((640,360),Image.Resampling.LANCZOS)
        captures.append(thumb)
    sheet=Image.new("RGB",(1280,5*400),(12,)*3)
    draw=ImageDraw.Draw(sheet)
    for i,(thumb,t) in enumerate(zip(captures,moments)):
        x=(i%2)*640;y=(i//2)*400
        sheet.paste(thumb,(x,y+36))
        draw.text((x+20,y+5),f"{t:04.1f}s",font=font(20),fill=(180,)*3)
    sheet.save(PREVIEWS/"contact-sheet.png")
    (PREVIEWS/"text-bounds.json").write_text(json.dumps(all_bounds,indent=2))
    frame_at(58.7).save(ROOT/"Lumbung-Preview.png")
    print("Rendered 10 representative frames; text bounds pass.")


def render(output,preview=False):
    width,height,fps=(1280,720,15) if preview else (W,H,FPS)
    video=ROOT/("picture-preview.mp4" if preview else "picture-master.mp4")
    music=ROOT/"music-original.wav"
    if not music.exists():
        make_music()
    write_captions()
    command=["ffmpeg","-hide_banner","-loglevel","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{width}x{height}","-r",str(fps),"-i","pipe:0","-an","-c:v","libx264","-preset","fast","-crf","19" if preview else "17","-pix_fmt","yuv420p","-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709",str(video)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE)
    begin=time.monotonic()
    try:
        for i in range(DURATION*fps):
            image=frame_at(i/fps)
            if preview:
                image=image.resize((width,height),Image.Resampling.LANCZOS)
            process.stdin.write(image.tobytes())
            if i%round(fps*5)==0:
                print(f"Rendered {i/fps:02.0f}/{DURATION}s ({time.monotonic()-begin:.1f}s elapsed)",flush=True)
    finally:
        process.stdin.close()
    if process.wait():
        raise RuntimeError("Picture encoding failed")
    # No narration; normalize the original score conservatively and mux explicit streams.
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(video),"-i",str(music),"-map","0:v:0","-map","1:a:0","-c:v","copy","-af","loudnorm=I=-18:TP=-1.5:LRA=9","-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",str(output)],check=True)
    print(f"Saved {output} ({output.stat().st_size/1048576:.1f} MiB)",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--stills",action="store_true")
    parser.add_argument("--preview",action="store_true")
    parser.add_argument("--output",default="Lumbung-Core-Features-60s.mp4")
    arguments=parser.parse_args()
    if arguments.stills:
        stills()
    else:
        destination=Path(arguments.output)
        if not destination.is_absolute():
            destination=ROOT/destination
        render(destination,arguments.preview)
