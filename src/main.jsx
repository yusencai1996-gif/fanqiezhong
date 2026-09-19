import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Widget from './components/Widget.jsx'
import './styles/global.css'

// 小插件模式:URL 带 ?widget=1 时渲染小插件,否则渲染主应用
const isWidget = new URLSearchParams(window.location.search).get('widget') === '1'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isWidget ? <Widget /> : <App />}
  </React.StrictMode>
)
