"""Render an original 60s monochrome feature trailer. No personal browser content.
Python + Pillow + NumPy; FFmpeg on PATH. --preview renders storyboards only.
"""
from pathlib import Path
from functools import lru_cache
import argparse, json, math, shutil, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parent
ASSETS=ROOT/'assets';OUT=ROOT/'output';OUT.mkdir(exist_ok=True)
W,H,FPS,DURATION=1920,1080,30,60
STARTS=[0,6,14,22,30,39,47,54,60]
CHAPTERS=['KEEP IT','CHOOSE','PRESERVE','MAKE ROOM','COLLECT','STAY INFORMED','LOCAL','DIALOGUE EXPORT']
WHITE=(244,244,241);MUTED=(165,165,163);DARK=(13,13,14)
FONTS=Path('C:/Windows/Fonts')

def clamp(x):return max(0.,min(1.,x))
def ease(x):x=clamp(x);return 1-(1-x)**3
def smooth(x):x=clamp(x);return x*x*(3-2*x)
def mix(a,b,t):return a+(b-a)*clamp(t)
@lru_cache(None)
def font(size,kind='sans'):
    return ImageFont.truetype(str(FONTS/({'sans':'segoeui.ttf','bold':'seguisb.ttf','light':'segoeuil.ttf','mono':'consola.ttf','mono_b':'consolab.ttf'}.get(kind,'segoeui.ttf'))),size)
@lru_cache(1000)
def text_img(text,size=30,kind='sans',color=WHITE):
    f=font(size,kind);box=f.getbbox(text or ' ')
    im=Image.new('RGBA',(max(1,math.ceil(f.getlength(text))+4),size+22),(0,0,0,0))
    ImageDraw.Draw(im).text((0,-box[1]),text,font=f,fill=color)
    return im
def txt(im,text,x,y,size=30,kind='sans',color=WHITE,alpha=1):
    tile=text_img(str(text),size,kind,tuple(color))
    if alpha<1:
        tile=tile.copy();tile.putalpha(tile.getchannel('A').point(lambda p:int(p*clamp(alpha))))
    im.paste(tile,(round(x),round(y)),tile)
def lines(im,items,x,y,size=84,gap=104,kind='bold',alpha=1):
    for n,s in enumerate(items):txt(im,s,x,y+n*gap,size,kind,alpha=alpha)
def line(im,xy,color=(65,65,65),width=1):ImageDraw.Draw(im).line(xy,fill=color,width=width)
def box(im,xy,fill=None,outline=(80,80,80),width=1):ImageDraw.Draw(im).rectangle(tuple(round(x) for x in xy),fill=fill,outline=outline,width=width)
def logo(im,x,y,size=52,color=WHITE):
    s=size/24;d=ImageDraw.Draw(im)
    outer=[(2,2),(22,2),(22,18),(11,18),(4,23),(4,18),(2,18)]
    inner=[(4,4),(20,4),(20,16),(10.4,16),(6,19.1),(6,16),(4,16)]
    d.polygon([(x+a*s,y+b*s) for a,b in outer],fill=color)
    d.polygon([(x+a*s,y+b*s) for a,b in inner],fill=im.getpixel((int(x),int(y))))
    for a,b,c,e in [(7,7,17,9),(7,11,14,13)]:d.rectangle((x+a*s,y+b*s,x+c*s,y+e*s),fill=color)
def corners(im,x,y,w,h,color=(190,190,190)):
    for xx,yy,sx,sy in [(x,y,1,1),(x+w,y,-1,1),(x,y+h,1,-1),(x+w,y+h,-1,-1)]:
        line(im,(xx+sx*22,yy,xx,yy,xx,yy+sy*22),color,2)
def pill(im,label,x,y,w=None,active=False):
    if w is None:w=font(25,'mono').getlength(label)+42
    box(im,(x,y,x+w,y+50),WHITE if active else DARK,(105,105,105))
    txt(im,label,x+20,y+13,25,'mono',DARK if active else WHITE)
    return w

BG=Image.new('RGB',(W,H),DARK)
d=ImageDraw.Draw(BG)
for x in range(80,W,80):
    for y in range(130,950,80):d.rectangle((x,y,x+1,y+1),fill=(37,37,38))
for yy in (108,978):d.line((96,yy,1824,yy),fill=(55,55,55))
@lru_cache(None)
def asset(name,width):
    src=Image.open(ASSETS/(name+'.png')).convert('RGB')
    src=ImageOps.grayscale(src).convert('RGB')
    return src.resize((width,round(src.height*width/src.width)),Image.Resampling.LANCZOS)
def image(im,name,x,y,width,alpha=1):
    a=asset(name,width)
    if alpha<1:
        a=a.convert('RGBA');a.putalpha(round(255*clamp(alpha)));im.paste(a,(round(x),round(y)),a)
    else:im.paste(a,(round(x),round(y)))
def viewport(im,name,x,y,width,height,scroll=0):
    a=asset(name,width);top=max(0,min(a.height-height,round(scroll)))
    tile=a.crop((0,top,width,top+height));im.paste(tile,(round(x),round(y)))
def cursor(im,x,y,tap=False):
    d=ImageDraw.Draw(im)
    p=[(x,y),(x+1,y+33),(x+9,y+24),(x+18,y+40),(x+25,y+36),(x+16,y+21),(x+29,y+20)]
    d.polygon(p,fill=WHITE,outline=(0,0,0),width=2)
    if tap:d.ellipse((x-14,y-14,x+14,y+14),outline=WHITE,width=2)
def shell(im,chapter,t,light=False):
    c=DARK if light else WHITE;muted=(100,100,100) if light else MUTED
    logo(im,96,47,40,c);txt(im,'DIALOGUE EXPORT',156,56,24,'mono_b',c)
    txt(im,'FIREFOX / 0.5.6 FEATURE PREVIEW',1320,59,20,'mono',muted)
    txt(im,f'{chapter+1:02d} / {CHAPTERS[chapter]}',96,1014,22,'mono',muted)
    txt(im,'DEMONSTRATION · FICTIONAL CHATS',1257,1016,20,'mono',muted)
    for n in range(8):
        x=647+n*64;fill=c if t>=STARTS[n] else ((190,190,190) if light else (62,62,62))
        line(im,(x,1025,x+44,1025),fill,3)
    line(im,(96,978,96+1728*t/DURATION,978),c,2)
def head(im,kicker,heading,subtitle,p,sz=94):
    a=ease(p/.7);dy=30*(1-a)
    txt(im,kicker,112,205+dy,22,'mono',MUTED,a)
    lines(im,heading,108,275+dy,sz,sz*1.17,alpha=a)
    for n,s in enumerate(subtitle):txt(im,s,112,545+n*43+dy,30,'sans',MUTED,a)

def scene(index,p,t):
    im=BG.copy();a=ease(p/.7)
    if index==0:
        txt(im,'IDEAS / ANSWERS / PLANS / POSSIBILITIES',112,212,24,'mono',MUTED,a)
        first='Good conversations.';second='Worth keeping.'
        txt(im,first[:int(len(first)*ease((p-.25)/1.0))],108,303,104,'bold')
        txt(im,second,108,431+30*(1-ease((p-1.0)/.7)),104,'bold',alpha=ease((p-1.0)/.7))
        txt(im,'Bring the useful part with you.',114,620,35,color=MUTED,alpha=ease((p-1.8)/.6))
        x,y=1280,282
        corners(im,x-20,y-20,490,410)
        logo(im,x+125,y+20,200)
        txt(im,'[ conversation → file ]',x+10,y+287,27,'mono',WHITE,ease((p-1.2)/.6))
        txt(im,'TXT  MD  HTML  JSON  PDF',112,815,29,'mono',WHITE,ease((p-2.4)/.6))
    elif index==1:
        head(im,'02 / EXPORT THE CURRENT CHAT',['Your chat.','Your format.'],['All messages or a selection.','One compact menu.'],p)
        txt(im,'Direct export for supported',112,721,25,'mono',MUTED)
        txt(im,'saved ChatGPT conversations.',112,757,25,'mono',MUTED)
        x=1360+50*(1-a);y=155
        box(im,(870,203,1305,860),(20,20,21),(60,60,60))
        txt(im,'WEEKEND PROJECT',901,237,23,'mono',MUTED)
        line(im,(900,285,1275,285))
        txt(im,'You',901,325,24,'mono_b');txt(im,'Where should I start?',901,376,25)
        txt(im,'Assistant',901,469,24,'mono_b');
        for i,s in enumerate(['Start with one idea.','Make a small plan.','Keep the details.']):txt(im,s,901,524+45*i,25,color=MUTED)
        txt(im,'[ ask anything… ]',901,789,22,'mono',MUTED)
        name='menu-md' if p<2.8 else 'menu-html' if p<5.7 else 'menu-pdf'
        image(im,name,x,y,374,a);corners(im,x-8,y-8,390,764)
        if 1.2<p<7.4:
            target=(x+275,y+292) if p<5.4 else (x+155,y+328)
            cursor(im,*target,tap=2.65<p<3.0 or 5.55<p<5.85)
    elif index==2:
        head(im,'03 / KEEP THE USEFUL DETAILS',['Code. Tables.','Images, too.'],['Readable HTML. Printable PDF.','Details worth coming back to.'],p,88)
        for j,s in enumerate(['[x] User images','[x] AI response images']):txt(im,s,112,727+50*j,28,'mono',WHITE,ease((p-1.4-j*.25)/.6))
        txt(im,'Choose each image category.',112,855,25,color=MUTED)
        x=965+50*(1-a);y=173
        box(im,(x-1,y-1,x+789,y+740),outline=(185,185,185))
        viewport(im,'document',x,y,788,740,260*smooth((p-1)/6))
        txt(im,'HTML / LOCAL FILE',x,y-40,22,'mono',MUTED)
    elif index==3:
        head(im,'04 / NUMBERED PARTS',['Long chats.','Smaller files.'],['Large direct ChatGPT HTML / PDF','exports split into numbered parts.'],p,90)
        txt(im,'HTML → sequential downloads',112,740,25,'mono',WHITE)
        txt(im,'PDF  → print each part',112,782,25,'mono',WHITE)
        for n in range(3):
            b=ease((p-.45*n-.6)/.9);x=925+n*271;y=267+n*46+100*(1-b)
            box(im,(x,y,x+245,y+455),(235,235,231),(235,235,231))
            txt(im,f'PART {n+1:02d}',x+23,y+27,26,'mono_b',DARK)
            line(im,(x+23,y+80,x+222,y+80),(95,95,95))
            for k in range(7):line(im,(x+24,y+120+k*29,x+175+(k%3)*19,y+120+k*29),(120,120,120),3)
            box(im,(x+23,y+343,x+221,y+410),(27,27,27))
            txt(im,f'[{n+1:03d} / 003]',x+34,y+366,23,'mono',WHITE)
            txt(im,f'part-{n+1:03d}',x+38,y+486,22,'mono',MUTED)
        line(im,(931,878,1768,878),(75,75,75),2)
        line(im,(931,878,931+837*ease((p-2)/4),878),WHITE,3)
    elif index==4:
        head(im,'05 / CHATGPT HISTORY → ZIP',['Build your','chat library.'],['Choose saved chats from the list.','Export a text-only ZIP archive.'],p,91)
        box(im,(112,719,716,853),(20,20,21),(95,95,95))
        txt(im,'[ archive.zip ]',138,743,31,'mono_b')
        txt(im,'index.html + chats/ + manifest.json',138,798,22,'mono',MUTED)
        txt(im,'Text, code, tables. Images and PDF excluded.',112,892,23,color=MUTED)
        x=924+40*(1-a);y=154
        image(im,'archive',x,y,850,a);corners(im,x-9,y-9,868,811)
        if 1.3<p<7.8:
            u=smooth((p-3)/2);cursor(im,mix(x+390,x+285,u),mix(y+363,y+580,u),tap=2.8<p<3.2)
    elif index==5:
        head(im,'06 / A REPORT YOU CAN READ',['Know what','made it.'],['Successful chats are kept.','Skipped chats have reasons.'],p,99)
        x=910;y=239+30*(1-a);w=856
        box(im,(x,y,x+w,y+590),(17,17,18),(105,105,105))
        txt(im,'ARCHIVE REPORT',x+35,y+32,26,'mono_b')
        txt(im,'Illustrative export',x+530,y+37,21,'mono',MUTED)
        line(im,(x+34,y+91,x+w-34,y+91),(70,70,70))
        for n,(num,label) in enumerate([('12','SAVED'),('1','SKIPPED'),('0','UNATTEMPTED')]):
            xx=x+37+n*266;aa=ease((p-.65-n*.2)/.6)
            txt(im,num,xx,y+121+30*(1-aa),86,'bold',WHITE,aa)
            txt(im,label,xx,y+224,21,'mono',MUTED,aa)
        line(im,(x+34,y+285,x+w-34,y+285),(70,70,70))
        txt(im,'[+] Failed chats — show reasons',x+36,y+327,27,'mono')
        txt(im,'Unsupported rich reference',x+36,y+391,25,color=MUTED,alpha=ease((p-2.5)/.7))
        txt(im,'RICH_REFERENCE',x+36,y+435,23,'mono',MUTED,ease((p-2.8)/.6))
        txt(im,'[ ZIP saved ]     [ JSON report saved ]',x+36,y+523,23,'mono',WHITE,ease((p-3.5)/.7))
        txt(im,'See what saved, failed or was not attempted.',910,875,24,color=MUTED)
    elif index==6:
        head(im,'07 / YOUR FILES, YOUR DEVICE',['Local by','design.'],['No developer uploads.','No analytics. No telemetry.'],p,100)
        x=904;y=407
        for n,(label,desc) in enumerate([('FIREFOX','your session'),('EXPORT','local processing'),('FILES','your device')]):
            xx=x+n*298;aa=ease((p-.5-n*.4)/.7)
            box(im,(xx,y+40*(1-aa),xx+250,y+238+40*(1-aa)),(19,19,20),(140,140,140))
            if n==0:logo(im,xx+95,y+35,60)
            elif n==1:txt(im,'[ >_ ]',xx+48,y+50,39,'mono_b')
            else:
                for z in range(3):box(im,(xx+78+z*13,y+34+z*13,xx+148+z*13,y+108+z*13),DARK,(210,210,210),2)
            txt(im,label,xx+36,y+146,28,'mono_b');txt(im,desc,xx+18,y+198,19,'mono',MUTED)
            if n<2:
                txt(im,'>',xx+263,y+101,29,'mono',MUTED)
                pulse=(p*.7-n*.25)%1
                line(im,(xx+253,y+275,xx+295,y+275),(55,55,55),2)
                dot=xx+253+42*pulse;box(im,(dot-2,y+273,dot+2,y+277),WHITE,None)
        txt(im,'Processed locally in Firefox.',905,749,26,'mono',MUTED)
    else:
        im=Image.new('RGB',(W,H),WHITE)
        line(im,(96,108,1824,108),(190,190,190));line(im,(96,978,1824,978),(190,190,190))
        logo(im,893,175+25*(1-a),134,DARK)
        title='Dialogue Export';tw=font(113,'bold').getlength(title)
        txt(im,title,(W-tw)/2,369+30*(1-a),113,'bold',DARK,a)
        phrase='Keep the conversation.';tw=font(45).getlength(phrase)
        txt(im,phrase,(W-tw)/2,541,45,'sans',(70,70,70),a)
        labels=['TXT','MD','HTML','JSON','PDF','ZIP'];x=(W-sum(font(25,'mono').getlength(s)+54 for s in labels)-22*(len(labels)-1))/2
        for label in labels:
            ww=font(25,'mono').getlength(label)+54
            box(im,(x,664,x+ww,717),None,(130,130,130));txt(im,'['+label+']',x+10,678,25,'mono',DARK);x+=ww+22
        url='github.com/vaulthunt3r/dialogue-export';tw=font(32,'mono').getlength(url)
        txt(im,url,(W-tw)/2,800,32,'mono',DARK,ease((p-.8)/.7))
        txt(im,'CHATGPT + GEMINI     /     FIREFOX EXTENSION',572,874,23,'mono',(90,90,90))
    shell(im,index,t,index==7)
    return im

def frame(t):
    i=max(n for n in range(8) if t>=STARTS[n]);p=t-STARTS[i]
    current=scene(i,p,t)
    if i>0 and p<.27:
        prev=scene(i-1,STARTS[i]-STARTS[i-1]-.01,STARTS[i]-.01)
        current=Image.blend(prev,current,smooth(p/.27))
    if t<.3:current=Image.blend(Image.new('RGB',(W,H),DARK),current,t/.3)
    return current

def sound():
    sr=48000;n=sr*DURATION;left=np.zeros(n,np.float32);right=np.zeros(n,np.float32);rng=np.random.default_rng(56)
    def add(start,signal,pan=0):
        a=round(start*sr);b=min(n,a+len(signal));length=b-a
        if length<=0:return
        left[a:b]+=signal[:length]*math.sqrt((1-pan)/2);right[a:b]+=signal[:length]*math.sqrt((1+pan)/2)
    def synth(freq,dur):
        t=np.arange(round(sr*dur),dtype=np.float32)/sr
        env=(1-np.exp(-t*30))*np.exp(-t*4)
        return (np.sin(2*np.pi*freq*t)+.24*np.sin(2*np.pi*freq*2*t)+.08*np.sin(2*np.pi*freq*3*t))*env
    beat=.6
    chords=[[146.832,174.614,220,261.626],[130.813,164.814,195.998,246.942],[110,130.813,164.814,195.998],[116.541,146.832,174.614,220]]
    for b in range(100):
        start=b*beat;ch=chords[(b//8)%4]
        if start<54:
            # Soft original step arpeggio, no sampled or licensed recording.
            add(start,synth(ch[[0,2,1,3,2,1,3,2][b%8]]*2,1.05)*.045,(-.2 if b%2 else .2))
            if b%2==0:
                t=np.arange(round(sr*.32),dtype=np.float32)/sr
                kick=np.sin(2*np.pi*(44*t+36*.025*(1-np.exp(-t/.025))))*np.exp(-t*14)
                add(start,kick*.095)
            if b%4==2:
                t=np.arange(round(sr*.14),dtype=np.float32)/sr;noise=rng.standard_normal(len(t)).astype(np.float32)
                add(start,noise*np.exp(-t*42)*.019)
            t=np.arange(round(sr*.065),dtype=np.float32)/sr;noise=rng.standard_normal(len(t)).astype(np.float32);noise=np.r_[0,np.diff(noise)]
            add(start+.3,noise*np.exp(-t*70)*.005,.28)
        if b%8==0:
            dur=min(5.8,DURATION-start);t=np.arange(round(sr*dur),dtype=np.float32)/sr
            env=np.minimum(t/.7,1)*np.minimum((dur-t)/1.1,1)
            pad=sum(np.sin(2*np.pi*f*t+np.sin(t*.3)*.08) for f in ch)/4
            add(start,pad*env*.075,-.1)
            add(start,np.sin(2*np.pi*ch[0]/2*t)*env*.04,.1)
    for start in STARTS[1:-1]:
        t=np.arange(int(sr*.7),dtype=np.float32)/sr
        add(start,synth(880,.7)*.028,.15)
    fade=np.minimum(np.arange(n)/(sr*1.3),1)*np.minimum((n-np.arange(n))/(sr*2),1)
    stereo=np.stack([left*fade,right*fade],axis=1);peak=float(np.max(np.abs(stereo)));stereo*=.63/max(peak,.001)
    with wave.open(str(OUT/'original-score.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes((stereo*32767).astype('<i2').tobytes())
    return {'sampleRate':sr,'duration':DURATION,'peakDbFS':round(20*math.log10(.63),2),'originalComposition':True}

CAPTIONS=[
 ('Good conversations. Worth keeping.','Bring the useful part with you.'),
 ('Your chat. Your format.','TXT, Markdown, HTML, JSON and PDF.'),
 ('Code. Tables. Images, too.','Choose user images and AI response images for HTML/PDF.'),
 ('Long chats. Smaller files.','Large direct ChatGPT HTML/PDF exports split into numbered parts.'),
 ('Build your chat library.','Select saved ChatGPT chats for a text-only ZIP archive.'),
 ('Know what made it.','Successful chats are kept. Skipped chats have reasons.'),
 ('Local by design.','No developer uploads, analytics or telemetry.'),
 ('Dialogue Export. Keep the conversation.','github.com/vaulthunt3r/dialogue-export')]
def stamp(t):return f'00:{int(t)//60:02d}:{int(t)%60:02d},000'
def previews():
    sheet=Image.new('RGB',(960*2,540*4),(27,27,27))
    for i in range(8):
        f=frame(STARTS[i]+(STARTS[i+1]-STARTS[i])*.65)
        f.save(OUT/f'scene-{i+1:02d}.png');sheet.paste(f.resize((960,540),Image.Resampling.LANCZOS),((i%2)*960,(i//2)*540))
    sheet.save(OUT/'storyboard.jpg',quality=90)
    frame(58).save(OUT/'Dialogue-Export-poster.png')
    (OUT/'Dialogue-Export-trailer.en.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(STARTS[i])} --> {stamp(STARTS[i+1])}\n{a}\n{b}' for i,(a,b) in enumerate(CAPTIONS))+'\n',encoding='utf-8')

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');args=ap.parse_args();previews()
    if not args.preview:
        audio=sound();output=OUT/'Dialogue-Export-0.5.6-trailer-EN.mp4'
        cmd=[shutil.which('ffmpeg'),'-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-i',str(OUT/'original-score.wav'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-t',str(DURATION),str(output)]
        with (OUT/'render.log').open('w') as log:
            proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
            try:
                for k in range(FPS*DURATION):
                    proc.stdin.write(frame(k/FPS).tobytes())
                    if k%(FPS*5)==0:print(f'Rendered {k//FPS:02d}/{DURATION} seconds',flush=True)
            finally:proc.stdin.close()
            assert proc.wait()==0,'FFmpeg failed; see render.log'
        (OUT/'render-info.json').write_text(json.dumps({'width':W,'height':H,'fps':FPS,'seconds':DURATION,'frames':FPS*DURATION,'language':'English','narration':False,'audio':audio,'content':'Fictional demonstration; real packaged UI markup and renderer output'},indent=2)+'\n')
        print(str(output),flush=True)
