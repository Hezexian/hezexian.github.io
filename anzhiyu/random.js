var posts=["2024/02/19/Qt程序打包发布，含第三方库/","2023/04/26/cmake包含vslam常用库/","2022/06/09/cmake+mingw32+win11+clion编译OpenCV4.5+contrib/","2024/01/08/C++Primer/","2024/01/31/emit和connect的顺序/","2024/01/03/git基本操作/","2024/01/02/hexo+github建站笔记/","2024/01/25/hexo代码块缩进问题/","2024/02/15/lsky+1panel+https+雨云配置/","2024/02/26/platformio配置/","2024/02/27/protues配置相关/","2024/02/19/vmware安装过增强工具还是无法拖放/","2023/12/26/旋转矩阵/","2024/02/24/通过代码配置PlatformIO生成HEX文件/","2021/06/01/孙鑫VC++深入详解/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };