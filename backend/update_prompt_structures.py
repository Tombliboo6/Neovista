import json

# 读取模板文件
with open('templates_v2.json', 'r', encoding='utf-8') as f:
    templates = json.load(f)

# 定义需要处理的模板 ID
missing_ids = ['2.1.1', '3.2.5', '5.1.1', '5.2.1', '5.5.1', '6.1.8', '6.4.1', '7.1.1', '7.2.1', '8.1.4', '9.1.1', '9.1.2', '9.1.3', '9.3.2', '9.3.3', '9.3.4', '9.3.5', '9.3.6', '9.4.1', '10.1.1']

# 手动提炼的 prompt_structure（先处理已有结构的 2 个）
prompt_structures = {
    '2.1.1': {
        "p0_text": "标题：{title}，技术标注：{data}，字体：现代极简工程字体，深灰色",
        "p1_user": "基于我上传的建筑白模，绘制日照/阴影分析图（Shadow Range Analysis）。",
        "p1_content": "背景纯白。建筑体块保持素模质感，顶部白色，侧面淡粉色受光面。\n分析图表层：建筑上方黄色虚线抛物线构成太阳运行轨迹（Sun Path），轨迹线上有黄色实心圆点代表太阳位置。地面围绕建筑有细线构成的罗盘日期圈。建筑背光侧展示累计阴影范围，由多层半透明的洋红色、紫色到粉色渐变色块重叠而成，模拟不同时间段的阴影覆盖区域。",
        "p2_lighting": "扁平化矢量风格，无复杂环境光遮蔽，强调图表信息清晰度。光影呈现为数据可视化逻辑，非写实渲染。",
        "p3_composition": "等轴测视图（Isometric View）。色彩：背景白，线条黄（太阳轨迹），阴影紫粉渐变（数据分析），高对比度信息图表风格。",
        "p4_rendering": "扁平化矢量风格（Flat Vector Style），学术分析图表风格"
    },
    '9.3.6': {
        "p0_text": "标题：{title}，散布带虚线边框的文本框，带有01-06等编号的圆形图标，字体：现代无衬线",
        "p1_user": "参考上传图片的排版和视觉风格，生成AIGC赋能建筑设计的拼贴策略图。",
        "p1_content": "中央核心展示AIGC软件使用场景：设计团队查看生成选项（01），机器人手臂制造3D打印模型（02）。周围元素：增强现实覆盖的建筑工地（03）、可视化过渡阶段（04）、环境数据分析软件（05）、参数化优化的建筑部分（06）。建筑景观切图风格，白底。",
        "p2_lighting": "明亮自然采光，营造创新、高效、可持续且现代化的视觉感受。",
        "p3_composition": "信息图表排版，虚线连接元素。微俯视视角。主色调：白、蓝、翠绿，辅以橙黄色点缀图标与边框。",
        "p4_rendering": "后现代数字拼贴风（Post-digital Collage Style）"
    },
    '3.2.5': {
        "p0_text": "标题：{title}，文字标注：{data}，字体：Helvetica，整齐对齐",
        "p1_user": "基于上传的建筑/景观照片，生成设计元素提取分析图，16:9横版，1:2水平分割布局。",
        "p1_content": "左1/3：高清建筑照片，圆形标注突出特征。黑色虚线连接到右侧。\n右2/3：水平行设计推演图，每行包含[Source源特征] → [Abstract 2D抽象线稿] → [3D Application三维应用]。\nRow 1: 构筑物几何 → 2D线稿 → 3D形态\nRow 2: 路径网络 → 2D线形 → 3D路网\nRow 3: 植物设计 → 2D植物图解 → 3D植物体块\nRow 4: 材质肌理 → 2D纹理阵列 → 3D材质附着\n关键：2D到3D拓扑结构必须完全一致。",
        "p2_lighting": "左侧自然光照，右侧柔和工作室光照，干净的环境光遮蔽阴影。",
        "p3_composition": "1:2水平分割，纯白背景。右侧主要为单色（灰度+纯白clay渲染），强调结构逻辑。包豪斯极简主义。",
        "p4_rendering": "后数字建筑概念图（Post-digital Architecture Concept Diagram），包豪斯极简风格"
    },
    '5.1.1': {
        "p0_text": "标题：CIRCULATION & VERTICALITY，字体：DIN Pro或Helvetica Bold，深炭灰色。左下角极简图例，圆点颜色与流线严格对应。",
        "p1_user": "基于上传的建筑模型，绘制动线与垂直交通分析图。",
        "p1_content": "建筑外壳：低透明度磨砂白色亚克力或半透明雾面玻璃，保留体积感同时透视内部结构。\n流线系统：\n- 水平公共流线：高亮青色（Cyan）实心宽色带，代表走廊、连廊及公共开放区\n- 垂直交通核：高饱和活力橙色（Orange），强调电梯井、楼梯间及核心筒，呈垂直体块或螺旋线\n关键出入口标注微小实心圆点或极简箭头，颜色与流线一致。",
        "p2_lighting": "柔和天光配合环境光遮蔽（AO），强调模型转角阴影增加体积感，避免死黑阴影。干净通透，类似高端建筑模型摄影棚。",
        "p3_composition": "等轴测视角（Isometric），纯白背景。青色与橙色互补配色。青色代表流动开放，橙色代表核心垂直连接。",
        "p4_rendering": "先锋建筑竞赛分析图风格（Avant-garde Competition Diagram），X-Ray透视感与实体模型结合，线条锐利"
    },
    '5.2.1': {
        "p0_text": "标题：3D CIRCULATION，字体：黑色无衬线。左下角带虚线边框图例，三项说明：橙色（核心人流）、青色（后勤/垂直交通）、莱姆绿（车行动线）。",
        "p1_user": "基于上传的建筑模型，绘制人行、车行与垂直交通分析图。",
        "p1_content": "建筑主体：幽灵模式渲染，低透明度磨砂亚克力与白色哑光素模（Clay），保持体块感同时透视内部楼板、中庭与坡道。\n三种流线路径：\n- 主要人流：发光电光橙色（Electric Orange）实心色带，贯穿主入口与核心空间\n- 次要/服务动线：青蓝色（Cyan）半透明管道状，代表后勤或垂直交通，缠绕电梯井与楼梯间\n- 车行动线：莱姆绿（Neon Lime Green）宽幅发光色带，带微妙行车线纹理，分布于基座、地下车库入口、卸货区及地面接驳环路\n所有流线具备锐利边缘，形成强烈视觉引导与层级对比。",
        "p2_lighting": "柔和漫射天光（Skylight），强调体积感的环境光遮蔽（AO），阴影柔和但层次分明。干净通透，现代参数化设计的精密感与科技感。",
        "p3_composition": "等轴测视角（Isometric），纯白或极淡冷灰色背景。主体居中，构图平衡。",
        "p4_rendering": "高端建筑可视化风格（High-end Architectural Visualization），现代参数化设计精密感"
    },
    '5.5.1': {
        "p0_text": "标题：{title}，每个场景下方带文字说明，字体：现代无衬线",
        "p1_user": "生成公共空间活动分析图，参照SASAKI风格，画面由8组独立等轴测微缩场景均匀排列组成，图片比例9:16。",
        "p1_content": "8组景观场景均匀分布，体块完整，每个微缩场景下方带文字说明。场景内容涵盖：多功能草坪休闲、儿童游乐区、滨水步道、户外展览、运动健身区、社区花园、露天剧场、夜间灯光广场等公共活动类型。每个场景为独立等轴测微缩模型，细节丰富，人物活动生动。",
        "p2_lighting": "明亮柔和的自然光，营造温馨活跃的公共空间氛围，轻微环境光遮蔽增加体积感。",
        "p3_composition": "9:16竖版，8组场景均匀网格排列。色彩明快，绿色植被、暖色人物与浅灰建筑形成层次对比。",
        "p4_rendering": "SASAKI风格插画（Isometric Illustration），精细等轴测微缩场景，2K/4K分辨率"
    },
    '6.1.8': {
        "p0_text": "去除所有广告牌文字、路牌标识、地面文字及水印，保持纯净几何表面。",
        "p1_user": "基于上传街景图，生成建筑白模渲染，再转化为爆炸轴测分析图。分两步完成。",
        "p1_content": "Step1 白模渲染：建筑主体、雨棚、收费岛、路面、护栏、路灯等硬质元素为无纹理白石膏材质，黑色描边强调结构轮廓。树木灌木简化为低多边形白色几何体块。车辆简化为带黑色描边的白色几何体。\nStep2 爆炸轴测：将白模各层级构件沿垂直轴向上分解爆炸，各层之间用细虚线连接，标注构件名称与功能说明。",
        "p2_lighting": "均匀漫射光，无强烈阴影，强调结构清晰度与图解信息传达。",
        "p3_composition": "等轴测视角，纯白背景。爆炸方向垂直向上，层级清晰，构图居中平衡。",
        "p4_rendering": "建筑技术分析图风格（Architectural Technical Diagram），白模+黑色描边，学术图解美学"
    },
    '6.4.1': {
        "p0_text": "标题：{title}，图注标签，字体：现代无衬线，排版简洁",
        "p1_user": "基于上传的平面图与透视图，生成剖透视分析图，宽幅横向构图（120cm×90cm）。",
        "p1_content": "画面为宽幅横向剖透视图，将建筑/景观沿主轴剖切，左侧展示剖面关系，右侧延伸为透视效果。剖切面以白色哑光材质呈现内部空间层次，外部保留写实拼贴质感（真实材质照片拼贴）。人物剪影、植被、家具等元素以拼贴方式融入，增强空间尺度感与生活气息。",
        "p2_lighting": "自然侧光，剖切面内部明亮，外部适度阴影，营造空间深度感。",
        "p3_composition": "宽幅横向（120:90），剖面居左，透视延伸居右。写实拼贴风格，材质照片与线稿叠加。",
        "p4_rendering": "后数字写实拼贴风格（Post-digital Realistic Collage），剖透视学术图纸美学"
    },
    '7.1.1': {
        "p0_text": "标题：ISOVIST ANALYSIS，字体：极简无衬线，画面边缘标注",
        "p1_user": "基于上传平面图，生成视域分析图（Isovist Analysis），高对比度极简风格。",
        "p1_content": "背景为高对比度极简建筑平面图，灰色实心粗线条代表墙体与障碍物。核心主体为从单一观察点发出的视域多边形（Isovist Field），高亮半透明色彩（亮黄或激光红）填充，清晰界定可见区域与阴影盲区（Blind Spots）。辅助元素包括细微放射状视线（Ray-casting lines）从观察点向外延伸。",
        "p2_lighting": "扁平化无光照，强调图表信息清晰度，高对比度黑白灰底图配合高亮分析色。",
        "p3_composition": "平面俯视图，纯白或深色背景。高亮视域色与灰色底图形成强烈对比，观察点以实心圆点标注。",
        "p4_rendering": "建筑竞赛分析图风格（Competition Diagram），极简高对比度，学术图解美学"
    },
    '7.2.1': {
        "p0_text": "标题：THERMAL COMFORT，字体：现代无衬线，画面上方排版简洁有力",
        "p1_user": "基于上传参考图，生成热舒适度感知模拟分析图，3D白色建筑体块叠加热力图。",
        "p1_content": "背景为极简城市街区平面底图，淡灰色线条勾勒道路网格。画面主体为高精度3D白色建筑体块模型，素模材质，布局疏密有致。地面叠加半透明热舒适度热力图（Heatmap），从深红（高温/不适）过渡到青蓝（凉爽/舒适）的渐变光谱，清晰展示风环境与日照对微气候的影响区域。",
        "p2_lighting": "均匀全局光照，无强烈方向性阴影，确保热力图色彩清晰可读。",
        "p3_composition": "微俯视等轴测视角，纯白或浅灰背景。白色体块与热力渐变色形成清晰对比，构图居中。",
        "p4_rendering": "建筑环境分析图风格（Environmental Analysis Diagram），白模+热力图叠加，学术可视化美学"
    },
    '8.1.4': {
        "p0_text": "标题：{title}，植物名称标注，字体：现代无衬线",
        "p1_user": "基于上传的植物图片，生成高分辨率植物配置与生态分析图板。",
        "p1_content": "严格基于上传植物图片分析植物种类、色彩与空间构成。图板包含：植物实景照片展示区、植物种类提取与标注、空间层次分析（乔木/灌木/地被）、色彩搭配图谱、生态功能说明。写实拼贴风格，植物照片与分析图解并置。",
        "p2_lighting": "自然明亮光照，植物色彩真实还原，清晰展示叶片纹理与层次关系。",
        "p3_composition": "横版图板布局，植物照片与分析图解均衡排列。绿色系为主色调，白色背景衬托。",
        "p4_rendering": "写实拼贴风格（Realistic Collage），高分辨率植物分析图板，学术图解美学"
    },
    '9.1.1': {
        "p0_text": "标题：{title}，科学标注与数据，字体：现代无衬线，学术排版",
        "p1_user": "生成地质与碳循环科学信息图，轴测剖面图形式，4:3横向比例。",
        "p1_content": "中心聚焦式布局，主体为巨大立体地块模型（Block Diagram），轴测剖面展示地表以下多个地质层次。地表以上展示植被、建筑、大气层的碳循环过程，箭头标注碳流动方向与数量。地表以下展示土壤碳库、岩石层、化石燃料层。各层次用不同色彩区分，配以科学标注说明生物地球化学过程。",
        "p2_lighting": "均匀漫射光，强调地质层次的色彩区分，无强烈阴影干扰信息读取。",
        "p3_composition": "4:3横向，中心聚焦，地块模型居中。色彩分层清晰，绿色（地表）、棕色（土壤）、深灰（岩石）渐变。",
        "p4_rendering": "科学信息图风格（Scientific Infographic），轴测插画，学术出版级质量"
    },
    '9.1.2': {
        "p0_text": "Title: {title}, scientific annotations and data, modern sans-serif font, academic layout",
        "p1_user": "Generate a highly professional Scientific Infographic on geology and carbon cycle, isometric cross-section format, 4:3 ratio.",
        "p1_content": "Center-focused layout with a large isometric block diagram as the main subject. Above ground: vegetation, buildings, atmosphere showing carbon cycle processes with directional arrows and quantities. Below ground: soil carbon layers, rock strata, fossil fuel deposits. Each layer differentiated by distinct colors with scientific annotations explaining biogeochemical processes.",
        "p2_lighting": "Uniform diffused lighting emphasizing color differentiation between geological layers, no harsh shadows interfering with information readability.",
        "p3_composition": "4:3 landscape, center-focused block diagram. Clear color stratification: green (surface), brown (soil), dark gray (rock) gradient.",
        "p4_rendering": "Scientific Infographic style, isometric illustration, academic publication quality"
    },
    '9.1.3': {
        "p0_text": "标题：UNDERSTANDING THE CONSTRUCTION CARBON CYCLE，字体：现代无衬线，学术排版",
        "p1_user": "生成建筑碳循环理解图，超宽横幅（21:9或3:1），线性时间轴/流程图形式。",
        "p1_content": "超宽横幅构图，展示建筑全生命周期碳排放流程：原材料开采→生产制造→运输→建造施工→使用运营→拆除回收。每个阶段用图标+数据+说明文字呈现，阶段间用箭头连接。关键数据以大字号突出显示，配以碳排放量对比图表。整体呈现线性时间轴逻辑。",
        "p2_lighting": "扁平化无光照，强调信息图表清晰度，矢量图解风格。",
        "p3_composition": "超宽横幅（21:9），线性从左到右流程排列。色彩：深色背景或白色背景，绿色（低碳）与红色（高碳）对比标注。",
        "p4_rendering": "矢量信息图表风格（Vector Infographic），建筑碳循环学术图解"
    },
    '9.3.2': {
        "p0_text": "标题：{title}，字体：现代无衬线",
        "p1_user": "生成高调极简主义建筑可视化效果图，城市广场场景，柔和漫射日光。",
        "p1_content": "宽阔城市广场，柔和漫射日光下的高调极简主义建筑可视化。场景特征：大面积浅色铺装地面，简洁几何体量建筑，稀疏点缀的人物剪影与植被。整体色调高亮、低饱和，强调建筑体量与空间关系。保持既有构图与氛围。",
        "p2_lighting": "柔和漫射日光（Soft Diffused Daylight），高调光照，无强烈阴影，营造宁静现代感。",
        "p3_composition": "宽幅横向构图，建筑主体居中，大面积留白强调极简美学。浅色系：白、米、浅灰为主。",
        "p4_rendering": "高端建筑可视化风格（High-end Architectural Visualization），极简主义美学"
    },
    '9.3.3': {
        "p0_text": "标题：{title}，字体：现代无衬线",
        "p1_user": "基于上传室内照片，将家具替换为高写实红木家具风格，保持原有空间构图与光照。",
        "p1_content": "使用Sony A7R IV摄影风格，Architectural Digest级质量，50mm f/1.8定焦镜头透视。保持原图空间布局与构图，将现有家具替换为精致红木家具：深色红木纹理、传统榫卯工艺细节、丝绒或皮革软包坐面。自然景深，真实环境遮挡（AO），物理写实渲染。",
        "p2_lighting": "自然光照为主，微妙胶片颗粒感，营造高端室内摄影质感。",
        "p3_composition": "保持原图构图，50mm标准视角，室内空间完整呈现。红木深色调与空间背景形成优雅对比。",
        "p4_rendering": "高写实室内摄影风格（Hyper-realistic Interior Photography），Architectural Digest级质量"
    },
    '9.3.4': {
        "p0_text": "标题：{title}，图注标签，字体：现代无衬线",
        "p1_user": "基于上传参考图，转换为垂直堆叠两部分建筑景观分析图：上半部分平面图，下半部分剖立面图。",
        "p1_content": "严格以参考图为结构底图，转换为后数字拼贴美学分析图。\n上半部分（50%）：平面图，展示空间布局、功能分区、流线关系，不同纹理与图案叠加表达功能区域。\n下半部分（50%）：剖立面图，展示垂直空间关系、材质层次、景观断面，写实材质照片与线稿叠加。\n整体呈现精致后数字拼贴美学，强调不同纹理、图案和图形元素的有意识叠加与并置。",
        "p2_lighting": "自然光照，剖面内部明亮，外部适度阴影，营造空间深度感。",
        "p3_composition": "竖版两部分垂直布局，各占50%。后数字拼贴风格，材质照片与线稿叠加，精致学术美学。",
        "p4_rendering": "后数字拼贴风格（Post-Digital Collage），建筑景观分析图，精致学术美学"
    },
    '9.3.5': {
        "p0_text": "标题：{title}，分析标注，字体：现代无衬线",
        "p1_user": "分两步：Step1分析上传实景照片的核心特征与设计概念；Step2基于分析生成手绘草图风格的概念设计分析图纸。",
        "p1_content": "Step1 分析：识别场地核心特征（空间类型、材质、植被、尺度），推导具有干预性/未来感/生态整合性的概念设计，输出结构化分析（底图特征、设计概念、空间策略、材质建议）。\nStep2 生成：基于Step1分析，生成手绘草图风格概念设计图纸，包含平面布局草图、空间意向草图、关键节点放大图，配以手写风格标注说明。",
        "p2_lighting": "手绘草图风格，铅笔/马克笔质感，自然光照意向表达。",
        "p3_composition": "A3横版或竖版，草图与分析文字均衡排列。手绘线条质感，局部彩色马克笔点缀。",
        "p4_rendering": "手绘概念草图风格（Hand-drawn Concept Sketch），建筑景观设计分析图纸"
    },
    '9.4.1': {
        "p0_text": "标题：{title}，字体：现代无衬线",
        "p1_user": "将上传建筑照片渲染为手工原木实体模型照片风格，保留原有建筑体块与空间布局。",
        "p1_content": "将原材质替换为浅色原木实体板材，呈现原木细腻纹理与切割边缘的轻微毛边。地形基底替换为浅棕色瓦楞纸板质感。还原手工模型真实细节：体块拼接处的自然缝隙、木材表面轻微打磨质感。模型放置于设计工作室环境中，背景简洁。",
        "p2_lighting": "工作室自然光照，柔和侧光强调木材纹理与体块关系，轻微阴影增加真实感。",
        "p3_composition": "等轴测或微俯视视角，模型居中，工作室背景简洁。浅木色调为主，温暖自然。",
        "p4_rendering": "手工模型摄影风格（Physical Model Photography），原木材质，设计工作室场景"
    },
    '10.1.1': {
        "p0_text": "标题：{title}，城市名称标注，字体：现代无衬线",
        "p1_user": "生成针对{city}的城市渲染数字艺术海报，核心主体为漂浮在白云上方、形状像该城市的微型岛屿。",
        "p1_content": "微型岛屿形状与城市地图轮廓相似，占据画面大部分内容，漂浮于白云之上。岛屿内部无缝融合城市标志性地标、自然景观及文化元素，布局参照城市实际规划。加入城市特有鸟类、电影般光影、鲜艳色彩、航拍视角和阳光反射效果。建筑密度适中，不宜过密。岛屿展现历史与现代的融合，体现城市独特气质。",
        "p2_lighting": "电影级光影，阳光从侧上方照射，云层漫射光，营造梦幻航拍感。",
        "p3_composition": "竖版海报构图，微型岛屿居中偏上，白云环绕，天空背景渐变。色彩鲜艳，饱和度高，电影感强。",
        "p4_rendering": "数字艺术海报风格（Digital Art Poster），城市微缩岛屿，电影级渲染质量"
    }
}

# 更新模板
updated_count = 0
for t in templates:
    if t['id'] in prompt_structures:
        t['prompt_structure'] = prompt_structures[t['id']]
        updated_count += 1
        print(f"✅ 已更新 {t['id']}: {t['title']}")

# 保存回文件
with open('templates_v2.json', 'w', encoding='utf-8') as f:
    json.dump(templates, f, ensure_ascii=False, indent=2)

print(f"\n共更新 {updated_count} 个模板")
