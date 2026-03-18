var Preview = window.Preview || (window.Preview = {});
var { useState, useRef, useEffect } = Preview.ReactHooks;

// ============================================================================
// 工具函数
// ============================================================================

// Polymarket favicon (base64 ICO)
const POLYMARKET_ICON = 'data:image/x-icon;base64,AAABAAEAMDAAAAEAIACoJQAAFgAAACgAAAAwAAAAYAAAAAEAIAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAD/XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XDD//1ww//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XTD//l4y//5fMf//XC3//1su//1dL//+XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9dMP//XjH//18z//9dMP//Vyr//FIi//hSIv/0XTT/9F80//taLP/+XS///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9dMf//XjL//10y//9bLf//VCX//FAg//pYLP/2b0f/85R2//fEs//55uD/9OXc//ZrQv//WCv//10w//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///10w//9eMf//XjL//10w//9WKP/+USL/+lQl//VgOP/zhGP/86+X//fXyv/5+Pb/+v////7//////v7//P////R/Xf//VCX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///10x//9eM//+XjH//1or//5UJP/8USH/91gr//h3UP/1mHz/98m4//ns6P/7/f3//P////z////9/////f////39/f///fz//f////J+Xf//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XTD//14y//9eMv//XC///1Yo//xPIf/1VCX/9WY+//OEZf/1uKH/9dzS//f6+f/7////////////////////+/////n18v/439P/8qKL//PJu////////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///l4w//9eMf/+WCv//VMj//tRIv/5Wy//9nZT//Sih//0ybv/+/Lt//z//v/+/////f////3//////////P78//ns5P/zv6//9pl7//VtRv/7Wy7/9kUS//SwnP///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL//+XS///VYo//hTJf/0a0T/8o5u//a4pf/55dz/+fr3//z////9/////f/////////9////+PTx//bUx//1q5P/83tZ//ZiN//3UiP//FIi//9YKv//XzP/+FMj//S1ov///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9dMf//Vyj/9YFd//XTxv/68/D//v///////v/9//////////v////7+/r/+ubf//W9qv/0jnH/925G//lUJ//9USH//1Um//9aLf/+XzL//l8y//9dMP//XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/8UCL/9L2t//z//////Pz///39///9/f/7+ff/8ca3//Saf//1dE3/+lwx//lUJv/9VCT//1kr//9eMf//XzL//14x//9dMP//XC///1wv//9cL///XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9eMv/7USH/8bys/////////Pv//v38///9/f/7+fb/8MW2//SNbv/4ckr/91ku//tUJP/9VyX//los//9eMf//XjP//10x//9cL///XC///1wv//9cL///XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8L6u/////////fz//////////////////f////v////6/Pn/9N7T//W7pv/zh2n/92g+//pUJv/+UCD//1Yn//9bLv//XjL//14y//9dMP//XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////69vT/7aSN//a5p//46eP/+/78//z////9/////v////7////8////+/Tv//TMvv/0pYv/83lU//ddLv/6UyP//VIi//5YKf//YDT/+FMk//S1ov///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////59vP/7mc+//lMHP/2YjX/9HtW//apj//20cP/9vLu//3///////7///////7////7////+fv5//nm3f/1vKv/9I9w//ZtRf/6Vyr/90US//SwnP///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////59/P/8XJM//9aLP//XC///1Yn//5RIv/5VCb/82tD//WMb//2uaX/+eXc//v6+P/9/////f////7//////////f////f08v/41Mj/8aKJ//HGt////////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////49/T/8nBJ//9XKf//XjH//10x//9fMv//XjH//lgq//1TIv/5UiL/+Fww//V4Uf/zo4r/88q7//v07//+/////v////7////9////+f////3//v///v7//f////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////49/T/8nBJ//9XKf//XTD//1wv//9cL///XC///10x//9eMv//XjL//1wv//9XKf/+UyP/+1Yn//hkOv/1f1v/9KuV//DZzv/7+/r///38///+/v///v7//f////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////49/T/8nBJ//9XKf//XTD//1wv//9cL///XC///10w//9eMv//XjL//1wv//9YKf/+UyP/+1Yn//hkOv/0flr/9KuV//DZz//6+/r///38///+/v///v7//f////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////49/T/8nBJ//9XKf//XjH//14x//9eMv//XjH//1gq//1TIf/4UiL/+Fww//V4UP/zo4n/88q6//r07//+/////v////7////9////+v////3//v///v7//f////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////49/P/8XJM//9aLP//XC///1Un//5RIv/6VCb/9WtE//SMb//1uaX/+eXd//v6+P/9/////f////7//////////f////f08v/31cn/8KGH//HGuP///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////59vP/7mY9//lMG//3YjX/9HlW//apj//30sT/9vLt//3///////////////7////8////+vv5//rm3f/0u6r/9I9w//VtRP/5Vyr/90YS//SwnP///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8b2t///////69vX/7KWN//e5p//56eL/+/38//z////+/////v////3////8/////PTv//TMvv/1poz/83lV//hdLv/6UyP//VIi//9YKv/+YDT/+FMk//S1ov///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7USH/8L6u/////////fz//////////////////P////v////6/Pr/897U//S6pP/zhmj/9mg+//pUJv/+UCD//1Yn//9bL///XjL//14y//9dMP//XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9eMv/7USH/8bys/////////Pv//v38///9/f/7+fb/8MW2//SNbv/4ckr/9lkt//xUI//9Vib//Vot//9eMf//XjP//10x//9cL///XC///1wv//9cL///XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9fMv/7UCH/9L2t//3//////Pz///39///9/f/7+ff/8cW3//SagP/2dE7/+V0w//pVJf/9VCT//1kr//9eMf//XzL//14x//9dMP//XC///1wv//9cL///XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9dMf/+Vyf/9YFd//bTx//79PD//v///////v/9/////v////v////7+/n/+ubf//a8qv/0j3H/925G//hUJ//9UCH//1Um//9aLf/+XzL//l8y//9dMP//XzL/+FEg//S0of///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XTD//lYp//hTJv/0a0T/8Y5u//a5pf/45dv/+fr3//z////9/////f/////////8////+PTx//bUx//2qpL/83tZ//ZiNv/4UiL//VEi//9YKv//XzP/+FMj//S1ov///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///l0x//5eMf/+WCv//VMj//xSIv/5Wy//93VS//Wih//0ybv/+/Lt//z//v/9/////f////7////+/////P79//rr4//yvq7/9pl7//VsR//7Wy7/9kUS//SwnP///////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XTD//14y//9eMv//XC///1Yo//1QIf/2VCX/9mY+//OEZf/1uKL/9tvS//f6+f/7////////////////////+v////n18v/43tT/8qKM//LJu////////P////J+Xv//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///10x//9fM///XjH//1or//5UJP/9USH/91gs//d2UP/0l3z/98m5//ns5//8/Pz//f////z////9/////f////z9/f///fz//P////J+Xf//VSX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///10w//9eMf//XzL//10v//9WKP/9USH/+VMk//dgN//0g2L/866X//bYy//4+PX/+f////7//////v7//f////R/Xf//VCX//14x//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9dMf//XjL//l0y//9bLf//VCX//FAh//pYLP/3b0f/8pR1//fEs//45t//9Obc//ZsQ//+WCv//10w//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cMP//XjH//18y//9dL///Vyr//FIi//lSIv/0XTT/9F81//paLP/+XS///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XTD//l4y//5fMf//XC3//1su//5dL//+XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XDD//1ww//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv//9cL///XC///1wv/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Extract sport code prefix from slug for Polymarket sports URL.
 * e.g. "cbb-lehi-pvam-2026-03-18" → "cbb"
 *      "nba-lal-bos-2026-03-18" → "nba"
 *      "epl-ars-che-2026-03-18" → "epl"
 */
function extractSlugSportCode(slug) {
    if (!slug) return null;
    const match = slug.match(/^([a-z][a-z0-9]*)-/i);
    return match ? match[1].toLowerCase() : null;
}

/**
 * PolymarketLink — 导航按钮 (在卡片 header 中使用)
 * URL: https://polymarket.com/sports/{sportCode}/{slug}
 */
const PolymarketLink = ({ slug, size = 18 }) => {
    if (!slug) return null;
    const sportCode = extractSlugSportCode(slug);
    if (!sportCode) return null;
    const url = `https://polymarket.com/sports/${sportCode}/${slug}`;
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-0.5 rounded-md bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-500/50 hover:bg-zinc-700/50 transition-all group"
            title="View on Polymarket"
            onClick={(e) => e.stopPropagation()}
        >
            <img
                src={POLYMARKET_ICON}
                alt="Polymarket"
                style={{ width: size, height: size }}
                className="opacity-70 group-hover:opacity-100 transition-opacity"
            />
        </a>
    );
};

const SPORT_ICONS = {
    nba: { emoji: '\u{1F3C0}', label: 'NBA' },
    nhl: { emoji: '\u{1F3D2}', label: 'NHL' },
    football: { emoji: '\u26BD', label: 'Football' },
    ncaa: { emoji: '\u{1F3C8}', label: 'NCAA' },
    lol: { emoji: '\u{1F3AE}', label: 'LoL' },
    cs2: { emoji: '\u{1F52B}', label: 'CS2' },
    dota2: { emoji: '\u{1F5E1}\uFE0F', label: 'Dota2' },
};

function formatPrice(price) {
    if (!Number.isFinite(price) || price <= 0 || price >= 1) return '--';
    return (price * 100).toFixed(1) + '\u00A2';
}

function formatDepth(depth) {
    if (!Number.isFinite(depth) || depth <= 0) return '';
    if (depth >= 1000) return `(${(depth / 1000).toFixed(1)}K)`;
    return `(${Math.round(depth)})`;
}

function formatVolume(vol) {
    if (!vol) return '$0';
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
    return `$${Math.round(vol)}`;
}

function formatDatetime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.toLocaleString('en', { month: 'short' });
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}`;
}

function computeCountdown(dateStr) {
    if (!dateStr) return { isLive: false, text: '' };
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff < 0) return { isLive: true, text: 'LIVE' };
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 48) return { isLive: false, text: `starts in ${Math.floor(h / 24)}d ${h % 24}h` };
    if (h > 0) return { isLive: false, text: `starts in ${h}h ${m}min` };
    return { isLive: false, text: `starts in ${m}min` };
}

/** Live-updating countdown hook (ticks every 30s) */
function useCountdown(dateStr) {
    const [cd, setCd] = useState(() => computeCountdown(dateStr));
    useEffect(() => {
        setCd(computeCountdown(dateStr));
        const id = setInterval(() => setCd(computeCountdown(dateStr)), 30000);
        return () => clearInterval(id);
    }, [dateStr]);
    return cd;
}

// ============================================================================
// FlashValue
// ============================================================================

const FlashValue = ({ value, format = formatPrice, className = '', children }) => {
    const prevRef = useRef(value);
    const [flash, setFlash] = useState('');
    const keyRef = useRef(0);

    useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = value;
        if (Math.abs(value - prev) > 0.0001) {
            setFlash(value > prev ? 'flash-up' : 'flash-down');
            keyRef.current++;
            const timer = setTimeout(() => setFlash(''), 1500);
            return () => clearTimeout(timer);
        }
    }, [value]);

    return (
        <span key={keyRef.current} className={`${className} ${flash}`.trim()}>
            {children || format(value)}
        </span>
    );
};

function flashValueSafe(price) {
    return Math.round(Number(price || 0) * 10000);
}

function getDepthTone(depth) {
    if (!Number.isFinite(depth) || depth <= 0) {
        return 'text-muted/50 border-border bg-background/30';
    }
    if (depth >= 1000) {
        return 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
    }
    if (depth >= 250) {
        return 'text-sky-300 border-sky-500/20 bg-sky-500/10';
    }
    return 'text-amber-300 border-amber-500/20 bg-amber-500/10';
}

const DepthChip = ({ depth }) => (
    <span className={`depth-chip ${getDepthTone(depth)}`}>
        {formatDepth(depth)}
    </span>
);

const QuoteLine = ({ label, labelClassName, price }) => (
    <div className="quote-line">
        <span className={`quote-label ${labelClassName}`}>{label}</span>
        <FlashValue
            value={flashValueSafe(price)}
            className="quote-price"
            format={() => formatPrice(price)}
        />
    </div>
);

function createTaskButtonClass(disabled) {
    if (disabled) {
        return 'flex-1 px-2 py-1.5 rounded-lg bg-card text-muted border border-border transition opacity-40 cursor-not-allowed text-[11px]';
    }

    return 'flex-1 px-2 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20 transition text-[11px]';
}

function resolveTradablePrice(primaryPrice, fallbackPrice) {
    const resolved = Number(primaryPrice || 0) > 0 ? Number(primaryPrice) : Number(fallbackPrice || 0);
    if (!Number.isFinite(resolved) || resolved <= 0 || resolved >= 1) {
        return 0;
    }
    return resolved;
}

// ============================================================================
// CardActiveTasks — 卡片内显示该市场的活跃任务
// ============================================================================

const CardActiveTasks = ({ tasks, pairings, onCancelTask, cancellingTaskId, columns }) => {
    if (!tasks || !tasks.length || !columns || !columns.length) return null;

    const allTokenIds = columns.filter(Boolean);
    const matched = tasks.filter(t => allTokenIds.includes(t.tokenId));
    if (matched.length === 0) return null;

    // Group by pairing
    const groups = {};
    matched.forEach(t => {
        const pid = String(t.resolvedPairingId || t.polyMultiPairingId || 'auto');
        if (!groups[pid]) groups[pid] = [];
        groups[pid].push(t);
    });

    const gridCls = columns.length === 3 ? 'grid-cols-3' : 'grid-cols-2';

    return (
        <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active Tasks</div>
            {Object.entries(groups).map(([pid, pTasks]) => {
                const p = pairings && pairings.find(x => String(x.id) === pid);
                const pairingLabel = p ? (p.name || `P#${p.id}`) : 'Auto';
                return (
                    <div key={pid} className="flex items-center gap-1.5">
                        <span className="font-bold px-1.5 py-0.5 rounded-lg bg-primary/15 text-primary font-mono shrink-0 text-[10px] min-w-[36px] text-center">
                            {pairingLabel}
                        </span>
                        <div className={`flex-1 grid ${gridCls} gap-2`}>
                            {columns.map((tokenId, idx) => {
                                if (!tokenId) return <div key={idx} />;
                                const task = pTasks.find(t => t.tokenId === tokenId);
                                if (!task) return <div key={idx} />;
                                const isCancelling = cancellingTaskId === task.id;
                                const filled = Number(task.filledQty || 0);
                                const total = Number(task.quantity || 0);
                                return (
                                    <div key={idx} className="flex items-center gap-1.5 bg-background/40 rounded-lg px-2 py-1.5 text-[11px] border border-border/50">
                                        <span className="font-semibold text-foreground truncate">{task.selectionLabel}</span>
                                        <span className="font-mono text-gray-400 shrink-0">{filled}/{total}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onCancelTask && onCancelTask(task.id); }}
                                            disabled={isCancelling}
                                            className="ml-auto shrink-0 w-5 h-5 flex items-center justify-center rounded-md border border-red-400/40 text-red-400 text-xs font-bold hover:bg-red-500 hover:text-white hover:border-red-500 transition-all disabled:opacity-40"
                                            title="取消任务"
                                        >
                                            {isCancelling ? '\u00B7' : '\u00D7'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// ============================================================================
// BinaryCard — 二元赛事卡片 (moneyline)
// ============================================================================

const BinaryCard = ({ market, onOpenTaskModal, taskEnabled, tradeEnabled, activeTasks, pairings, onCancelTask, cancellingTaskId }) => {
    const sport = SPORT_ICONS[market.sport] || { emoji: '\u{1F3AF}', label: market.sport };
    const ob = market.orderbook || {};
    const datetime = formatDatetime(market.gameStartTime);
    const { isLive, text: countdownText } = useCountdown(market.gameStartTime);
    const awayPrice = resolveTradablePrice(ob.awayBid, market.awayPrice);
    const homePrice = resolveTradablePrice(ob.homeBid, market.homePrice);
    const awayDisabled = !taskEnabled || !market.awayTokenId || awayPrice <= 0;
    const homeDisabled = !taskEnabled || !market.homeTokenId || homePrice <= 0;

    const openTaskModal = (selection) => {
        if (!onOpenTaskModal) return;

        if (selection === 'away') {
            onOpenTaskModal({
                tokenId: market.awayTokenId,
                conditionId: market.conditionId,
                side: 'BUY',
                price: awayPrice,
                quantity: ob.homeAskDepth || 0,
                negRisk: market.negRisk,
                orderType: 'GTC',
                eventTitle: market.eventTitle || market.question,
                marketQuestion: market.question || market.eventTitle,
                selectionLabel: market.awayTeam,
                sport: market.sport,
                marketType: market.marketType,
                hedgeTokenId: market.homeTokenId,
                hedgeSide: 'BUY',
                hedgeSelectionLabel: market.homeTeam,
                gameStartTime: market.gameStartTime,
                maxQuantity: ob.homeAskDepth || 0,
            });
            return;
        }

        onOpenTaskModal({
            tokenId: market.homeTokenId,
            conditionId: market.conditionId,
            side: 'BUY',
            price: homePrice,
            quantity: ob.awayAskDepth || 0,
            negRisk: market.negRisk,
            orderType: 'GTC',
            eventTitle: market.eventTitle || market.question,
            marketQuestion: market.question || market.eventTitle,
            selectionLabel: market.homeTeam,
            sport: market.sport,
            marketType: market.marketType,
            hedgeTokenId: market.awayTokenId,
            hedgeSide: 'BUY',
            hedgeSelectionLabel: market.awayTeam,
            gameStartTime: market.gameStartTime,
            maxQuantity: ob.awayAskDepth || 0,
        });
    };

    return (
        <div className="bg-surface rounded-2xl p-5 border border-border transition-all duration-200 hover:scale-[1.01] hover:border-primary relative">
            {/* Header: sport + time */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{sport.emoji}</span>
                    <span className="text-sm font-medium text-gray-400">{sport.label}</span>
                    {market.rewardsDailyRate > 0 && (
                        <span style={{color: '#facc15', fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em'}}>
                            REWARDS: ${Math.round(market.rewardsDailyRate)} USDC
                        </span>
                    )}
                    <PolymarketLink slug={market.polymarketSlug} />
                </div>
                <div className="text-right">
                    {isLive ? (
                        <div className="text-xs font-mono text-red-400 font-semibold flex items-center justify-end gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-blink-slow" />
                            LIVE
                        </div>
                    ) : countdownText && (
                        <div className="text-[11px] font-mono text-amber-400 font-medium">{countdownText}</div>
                    )}
                    {datetime && (
                        <div className="text-[10px] text-foreground font-mono">{datetime}</div>
                    )}
                </div>
            </div>

            {/* Teams */}
            <div className="text-center mb-3">
                <span className="text-base font-medium text-foreground">{market.awayTeam}</span>
                <span className="text-sm text-foreground mx-2">vs</span>
                <span className="text-base font-medium text-foreground">{market.homeTeam}</span>
            </div>

            {/* Orderbook — 2 column */}
            <div className="grid grid-cols-2 gap-4 mb-3">
                {/* Away */}
                <div className="quote-panel">
                    <div className="text-xs text-muted mb-1 truncate">{market.awayTeam}</div>
                    <div className="space-y-1">
                        <QuoteLine
                            label="Bid"
                            labelClassName="text-emerald-400/90"
                            price={ob.awayBid || 0}
                            depth={ob.awayBidDepth || 0}
                        />
                        <QuoteLine
                            label="Ask"
                            labelClassName="text-rose-400/90"
                            price={ob.awayAsk || 0}
                            depth={ob.awayAskDepth || 0}
                        />
                    </div>
                    {ob.awayAsk > 0 && ob.awayBid > 0 && (
                        <div className="quote-spread">
                            Spr: {((ob.awayAsk - ob.awayBid) * 100).toFixed(1) + '\u00A2'}
                        </div>
                    )}
                </div>

                {/* Home */}
                <div className="quote-panel">
                    <div className="text-xs text-muted mb-1 truncate">{market.homeTeam}</div>
                    <div className="space-y-1">
                        <QuoteLine
                            label="Bid"
                            labelClassName="text-emerald-400/90"
                            price={ob.homeBid || 0}
                            depth={ob.homeBidDepth || 0}
                        />
                        <QuoteLine
                            label="Ask"
                            labelClassName="text-rose-400/90"
                            price={ob.homeAsk || 0}
                            depth={ob.homeAskDepth || 0}
                        />
                    </div>
                    {ob.homeAsk > 0 && ob.homeBid > 0 && (
                        <div className="quote-spread">
                            Spr: {((ob.homeAsk - ob.homeBid) * 100).toFixed(1) + '\u00A2'}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="border-t-2 border-border pt-3">
                <div className="text-[10px] font-medium text-gray-400 mb-3">
                    Vol: <span className="font-bold text-foreground">{formatVolume(market.volume)}</span>
                    {market.liquidity > 0 && <span> | Liq: <span className="font-bold text-foreground">{formatVolume(market.liquidity)}</span></span>}
                </div>
                {tradeEnabled && (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => openTaskModal('away')}
                            disabled={awayDisabled}
                            className={`py-2.5 rounded-xl text-white text-xs font-bold transition-all duration-200 ${awayDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                            style={{ background: awayDisabled ? '#374151' : 'rgba(37, 99, 235, 0.4)' }}
                        >
                            <div>{market.awayTeam}</div>
                            <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                {formatPrice(awayPrice)}
                                {(ob.homeAskDepth > 0) && ` · ${formatDepth(ob.homeAskDepth)}`}
                            </div>
                        </button>
                        <button
                            onClick={() => openTaskModal('home')}
                            disabled={homeDisabled}
                            className={`py-2.5 rounded-xl text-white text-xs font-bold transition-all duration-200 ${homeDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                            style={{ background: homeDisabled ? '#374151' : 'rgba(220, 38, 96, 0.4)' }}
                        >
                            <div>{market.homeTeam}</div>
                            <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                {formatPrice(homePrice)}
                                {(ob.awayAskDepth > 0) && ` · ${formatDepth(ob.awayAskDepth)}`}
                            </div>
                        </button>
                    </div>
                )}
                <CardActiveTasks
                    tasks={activeTasks}
                    pairings={pairings}
                    onCancelTask={onCancelTask}
                    cancellingTaskId={cancellingTaskId}
                    columns={[market.awayTokenId, market.homeTokenId]}
                />
            </div>
        </div>
    );
};

// ============================================================================
// ThreeWayCard — 足球三方卡片
// ============================================================================

const ThreeWayCard = ({ market, onOpenTaskModal, taskEnabled, tradeEnabled, activeTasks, pairings, onCancelTask, cancellingTaskId }) => {
    const sport = SPORT_ICONS[market.sport] || { emoji: '\u26BD', label: 'Football' };
    const datetime = formatDatetime(market.gameStartTime);
    const { isLive, text: countdownText } = useCountdown(market.gameStartTime);
    const rawSelections = market.selections || [];
    // Sort: away first, draw middle, home last — matching title "awayTeam vs homeTeam"
    const selections = [...rawSelections].sort((a, b) => {
        const order = (s) => s.label === market.awayTeam ? 0 : (s.label === 'Draw' || s.label.startsWith('Draw')) ? 1 : s.label === market.homeTeam ? 2 : 1;
        return order(a) - order(b);
    });

    return (
        <div className="bg-surface rounded-2xl p-5 border border-border transition-all duration-200 hover:scale-[1.01] hover:border-secondary relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{sport.emoji}</span>
                    <span className="text-sm font-medium text-gray-400">{sport.label}</span>
                    {market.rewardsDailyRate > 0 && (
                        <span style={{color: '#facc15', fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em'}}>
                            REWARDS: ${Math.round(market.rewardsDailyRate)} USDC
                        </span>
                    )}
                    <PolymarketLink slug={market.polymarketSlug} />
                </div>
                <div className="text-right">
                    {isLive ? (
                        <div className="text-xs font-mono text-red-400 font-semibold flex items-center justify-end gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-blink-slow" />
                            LIVE
                        </div>
                    ) : countdownText && (
                        <div className="text-[11px] font-mono text-amber-400 font-medium">{countdownText}</div>
                    )}
                    {datetime && (
                        <div className="text-[10px] text-foreground font-mono">{datetime}</div>
                    )}
                </div>
            </div>

            {/* Teams */}
            <div className="text-center mb-3">
                <span className="text-base font-medium text-foreground">{market.awayTeam}</span>
                <span className="text-sm text-foreground mx-2">vs</span>
                <span className="text-base font-medium text-foreground">{market.homeTeam}</span>
            </div>

            {/* 3-way selections — always 3 columns */}
            <div className="grid grid-cols-3 gap-2 mb-3">
                {selections.map((sel, idx) => (
                    <div key={idx} className="quote-panel">
                        <div className="text-xs text-muted mb-1 truncate">{sel.label}</div>
                        <div className="text-sm font-mono font-medium text-foreground">
                            <FlashValue
                                value={flashValueSafe(sel.ask > 0 && sel.ask < 1 ? sel.ask : sel.price)}
                                className="quote-price"
                                format={() => formatPrice(sel.ask > 0 && sel.ask < 1 ? sel.ask : sel.price)}
                            />
                        </div>
                        <div className="text-[10px] text-muted/70 font-mono mt-1 flex items-center justify-center gap-1 flex-wrap">
                            {sel.ask > 0 && sel.ask < 1 ? (
                                <>
                                    <FlashValue
                                        value={flashValueSafe(sel.bid || 0)}
                                        className="text-sky-300"
                                        format={() => `Bid ${formatPrice(sel.bid)}`}
                                    />
                                    <DepthChip depth={sel.askDepth} />
                                </>
                            ) : (
                                <span>--</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="border-t-2 border-border pt-3">
                <div className="text-[10px] font-medium text-gray-400 mb-3">
                    Vol: <span className="font-bold text-foreground">{formatVolume(market.volume)}</span>
                </div>
                {tradeEnabled && (
                    <div className="grid grid-cols-3 gap-2">
                        {selections.map((sel, idx) => {
                            const selDisabled = !taskEnabled || !sel.tokenId || resolveTradablePrice(sel.bid, sel.price) <= 0;
                            const isDraw = sel.label === 'Draw' || sel.label.startsWith('Draw');
                            const isHome = sel.label === market.homeTeam;
                            const bg = selDisabled ? '#374151' : isDraw ? '#808898' : isHome ? 'rgba(220, 38, 96, 0.4)' : 'rgba(37, 99, 235, 0.4)';
                            // Hedge depth: No askDepth = Yes bidDepth
                            const hedgeDepth = sel.bidDepth || 0;
                            return (
                                <button
                                    key={idx}
                                    onClick={() => onOpenTaskModal && onOpenTaskModal({
                                        tokenId: sel.tokenId,
                                        conditionId: sel.conditionId || market.conditionId,
                                        side: 'BUY',
                                        price: resolveTradablePrice(sel.bid, sel.price),
                                        quantity: hedgeDepth,
                                        negRisk: market.negRisk,
                                        orderType: 'GTC',
                                        eventTitle: market.eventTitle || market.question,
                                        marketQuestion: market.question || market.eventTitle,
                                        selectionLabel: sel.label,
                                        sport: market.sport,
                                        marketType: market.marketType,
                                        hedgeTokenId: sel.noTokenId || '',
                                        hedgeSide: 'BUY',
                                        hedgeSelectionLabel: sel.label + ' No',
                                        gameStartTime: market.gameStartTime,
                                        maxQuantity: hedgeDepth,
                                    })}
                                    disabled={selDisabled}
                                    className={`py-2 rounded-xl text-white text-xs font-bold transition-all duration-200 ${selDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105'}`}
                                    style={{ background: bg }}
                                >
                                    <div>{isDraw ? 'Draw' : sel.label}</div>
                                    <div className="font-mono text-white/80 text-[10px] mt-0.5">
                                        {formatPrice(resolveTradablePrice(sel.bid, sel.price))}
                                        {(hedgeDepth > 0) && ` · ${formatDepth(hedgeDepth)}`}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
                <CardActiveTasks
                    tasks={activeTasks}
                    pairings={pairings}
                    onCancelTask={onCancelTask}
                    cancellingTaskId={cancellingTaskId}
                    columns={selections.map(s => s.tokenId)}
                />
            </div>
        </div>
    );
};

// ============================================================================
// SportsCard — dispatch
// ============================================================================

const SportsCard = (props) => {
    const mt = props.market.marketType;
    if (mt === 'three-way' || props.market.isThreeWay) {
        return <ThreeWayCard {...props} />;
    }
    if (mt === 'moneyline') {
        return <BinaryCard {...props} />;
    }
    // futures/outright — 暂不显示，后续可添加 FuturesCard
    return null;
};

Preview.SportsCard = SportsCard;
Preview.SPORT_ICONS = SPORT_ICONS;
