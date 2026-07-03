#!/usr/bin/env python3
# backpack_ragnarok mock build: inlines sprite + js into the template -> ../web/mock/index.html
import os
d=os.path.dirname(os.path.abspath(__file__))
tpl=open(os.path.join(d,'index.template.html')).read()
out=tpl.replace('<!--SPRITE-->',open(os.path.join(d,'item_icons_all.svg')).read())
out=out.replace('<!--DATA-->',open(os.path.join(d,'data.js')).read())
out=out.replace('<!--ENGINE-->',open(os.path.join(d,'engine.js')).read())
out=out.replace('<!--UI-->',open(os.path.join(d,'ui.js')).read())
dst=os.path.join(d,'..','web','mock','index.html')
open(dst,'w').write(out)
print('built',dst,len(out),'bytes')
