#!/usr/bin/env python3
# backpack_ragnarok mock build: inlines sprite + js into the template -> ../web/mock/index.html
import os
d=os.path.dirname(os.path.abspath(__file__))
tpl=open(os.path.join(d,'index.template.html')).read()
sprite_path=os.path.join(d,'..','content','sprite_all_v7.svg')
out=tpl.replace('<!--SPRITE-->',open(sprite_path).read())
out=out.replace('<!--DATA-->',open(os.path.join(d,'data.js')).read())
out=out.replace('<!--ENGINE-->',open(os.path.join(d,'engine.js')).read())
out=out.replace('<!--UI-->',open(os.path.join(d,'ui.js')).read())
dst=os.path.join(d,'..','web','mock','index.html')
open(dst,'w').write(out)
print('built',dst,len(out),'bytes','from',sprite_path)
