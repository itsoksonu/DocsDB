export {
  Search,
  Upload,
  User,
  Users,
  Code,
  Menu,
  X,
  Home,
  Settings,
  LogOut,
  FileText,
  TrendingUp,
  Bell,
  Heart,
  Download,
  Eye,
  Calendar,
  Filter,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
  Flag,
  CloudUpload,
  Bookmark,
  HelpCircle,
  Share2,
  EyeOff,
  MoreVertical,
  BookmarkCheck,
  Edit,
  Save,
  Image,
  Mail,
  ChevronLeft,
  ChevronUp,
  Maximize2,
  Minimize2,
  Shield,
  FileSearch,
  Trash2,
  MessageSquare,
  Copy,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  RotateCw,
  AlertTriangle,
  Clock,
  HardDrive,
  Tag,
  Globe,
  Lock,
  Layers,
  BarChart3,
  ExternalLink,
  ArrowLeft,
  ShieldAlert,
  Send,
  Square,
} from "lucide-react";

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

// The arrow is drawn in the middle 40% of a 1024 canvas, so the viewBox is
// tightened to its bounding box - otherwise it renders as a speck at 18px.
export const SendArrow = ({ size = 20, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="256 242 512 512"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M705.536 433.664a38.4 38.4 0 1 1-54.272 54.272L550.4 387.114667V729.6a38.4 38.4 0 0 1-76.8 0V387.114667l-100.864 100.821333a38.4 38.4 0 1 1-54.272-54.272l166.4-166.4a38.4 38.4 0 0 1 54.272 0l166.4 166.4z" />
  </svg>
);

export const AskAi = ({ size = 20, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 128 128"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path d="M93.07,22H69V14.8A2.8,2.8,0,0,0,66.2,12H61.8A2.8,2.8,0,0,0,59,14.8V22H34.93A18.94,18.94,0,0,0,16,40.93V52.21A46.79,46.79,0,0,0,62.79,99H66.2A2.8,2.8,0,0,0,69,96.2V91.8A2.8,2.8,0,0,0,66.2,89H62.79A36.79,36.79,0,0,1,26,52.21V40.93A8.93,8.93,0,0,1,34.93,32H93.07A8.93,8.93,0,0,1,102,40.93V53a34.27,34.27,0,0,1-1,8.14,2.79,2.79,0,0,0,1.84,3.34l4.2,1.37a2.79,2.79,0,0,0,3.58-1.95A44.41,44.41,0,0,0,112,53V40.93A18.94,18.94,0,0,0,93.07,22Z" />
    <circle cx="48" cy="56" r="8" />
    <circle cx="80" cy="56" r="8" />
    <path d="M111.73,92.8l9.06,3.57a1,1,0,0,1,0,1.86l-9.06,3.57a12.61,12.61,0,0,0-7.09,7.09l-3.57,9a1,1,0,0,1-1.86,0l-3.57-9a12.58,12.58,0,0,0-7.09-7.09l-9-3.57a1,1,0,0,1,0-1.86l9-3.57a12.58,12.58,0,0,0,7.09-7.09l3.57-9a1,1,0,0,1,1.86,0l3.57,9A12.61,12.61,0,0,0,111.73,92.8Z" />
  </svg>
);

export const Logo = ({ size = 40, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="128"
      cy="128"
      r="88"
      stroke="currentColor"
      strokeWidth="20"
      fill="none"
    />
    <line
      x1="88"
      y1="168"
      x2="168"
      y2="88"
      stroke="currentColor"
      strokeWidth="20"
      strokeLinecap="round"
    />
  </svg>
);
