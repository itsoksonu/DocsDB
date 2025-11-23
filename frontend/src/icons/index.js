export { Search, Upload, User, Users, Code, Menu, X, Home, Settings, LogOut, FileText, TrendingUp, Bell, Heart, Download, Eye, Calendar, Filter, ChevronDown, ChevronRight, Plus, Check, AlertCircle, Loader2, Sparkles, Flag, CloudUpload, Bookmark, HelpCircle, Share2, EyeOff, MoreVertical, BookmarkCheck, Edit, Save, Image, Mail, ChevronLeft, ChevronUp } from 'lucide-react';

export { FaGoogle, FaFacebook, FaGithub } from "react-icons/fa";

export const Loader = ({ size = 24, className = "" }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    className={className}
  >
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>
);

export const Logo = ({size = 40, className = ""}) => (
  <svg width={size} height={size} viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <circle cx="128" cy="128" r="88" stroke="currentColor" strokeWidth="20" fill="none"/>
    <line x1="88" y1="168" x2="168" y2="88" stroke="currentColor" strokeWidth="20" strokeLinecap="round"/>
  </svg>
);