import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../components/Notification';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

const BlogDetail = () => {
  const { slug } = useParams();
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [recentBlogs, setRecentBlogs] = useState([]);

  useEffect(() => {
    fetchBlog();
  }, [slug]);

  useEffect(() => {
    if (blog) {
      fetchRecentBlogs();
    }
  }, [blog]);

  const fetchBlog = async () => {
    try {
      const response = await api.get(`/blogs/${slug}`);
      setBlog(response.data);
      setIsLiked(
        user && response.data.likes?.some(like => 
          (typeof like === 'object' ? like._id : like) === user._id
        )
      );
    } catch (error) {
      console.error('Error fetching blog:', error);
      showNotification('Blog not found', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async () => {
    if (!user) {
      showNotification('Please login to like blogs', 'warning');
      return;
    }

    try {
      const response = await api.post(`/blogs/${slug}/like`);
      setIsLiked(response.data.isLiked);
      setBlog(prev => ({
        ...prev,
        likes: response.data.likes,
      }));
    } catch (error) {
      showNotification('Failed to like blog', 'error');
    }
  };

  const handleComment = async (e) => {
    e.preventDefault();
    if (!user) {
      showNotification('Please login to comment', 'warning');
      return;
    }

    if (!commentText.trim()) {
      showNotification('Please enter a comment', 'warning');
      return;
    }

    try {
      const response = await api.post(`/blogs/${slug}/comment`, {
        content: commentText,
      });
      setBlog(prev => ({
        ...prev,
        comments: [...(prev.comments || []), response.data],
      }));
      setCommentText('');
      showNotification('Comment added successfully', 'success');
    } catch (error) {
      showNotification('Failed to add comment', 'error');
    }
  };

  const handleShare = async (platform) => {
    const url = window.location.href;
    const text = blog?.title || 'Check out this blog post!';

    const shareUrls = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    };

    if (shareUrls[platform]) {
      window.open(shareUrls[platform], '_blank', 'width=600,height=400');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!blog) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Blog not found</p>
      </div>
    );
  }

  const fetchRecentBlogs = async () => {
    try {
      const response = await api.get('/blogs');
      setRecentBlogs(response.data.filter(b => b._id !== blog._id).slice(0, 5));
    } catch (error) {
      console.error('Error fetching recent blogs:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <Link
          to="/blogs"
          className="inline-flex items-center text-blue-500 hover:text-blue-600 dark:text-blue-400 mb-6"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Blogs
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3">
            {/* Blog Header */}
            <article className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mb-8">
              {blog.thumbnail && (
                <img
                  src={blog.thumbnail}
                  alt={blog.title}
                  className="w-full h-96 object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
              <div className="p-8">
                <div className="flex items-center justify-between mb-4">
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm">
                    {blog.category}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(blog.publishedAt || blog.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4 text-left">
                  {blog.title}
                </h1>

            <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                  {blog.author?.username?.[0]?.toUpperCase() || 'A'}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {blog.author?.username || 'Admin'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {blog.views || 0} views
                  </p>
                </div>
              </div>

              {/* Like and Share */}
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleLike}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                    isLiked
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  <svg className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  <span>{blog.likes?.length || 0}</span>
                </button>
                <div className="relative group">
                  <button className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                    Share
                  </button>
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                    <div className="p-2">
                      <button
                        onClick={() => handleShare('twitter')}
                        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center space-x-2"
                      >
                        <span>🐦</span>
                        <span>Twitter</span>
                      </button>
                      <button
                        onClick={() => handleShare('facebook')}
                        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center space-x-2"
                      >
                        <span>📘</span>
                        <span>Facebook</span>
                      </button>
                      <button
                        onClick={() => handleShare('linkedin')}
                        className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center space-x-2"
                      >
                        <span>💼</span>
                        <span>LinkedIn</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

                {/* Blog Content */}
                <div className="prose dark:prose-invert max-w-none mb-8">
                  <div className="text-gray-800 dark:text-gray-200">
                    <BlogContentRenderer content={blog.content} />
                  </div>
                </div>

                {/* Tags */}
                {blog.tags && blog.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-8">
                    {blog.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full text-sm"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Comments Section */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                    Comments ({blog.comments?.length || 0})
                  </h2>

                  {/* Add Comment */}
                  {user ? (
                    <form onSubmit={handleComment} className="mb-6">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Write a comment..."
                        className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white mb-2"
                        rows="3"
                      />
                      <button
                        type="submit"
                        className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        Post Comment
                      </button>
                    </form>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                      <Link to="/login" className="text-blue-500 hover:underline">Login</Link> to comment
                    </p>
                  )}

                  {/* Comments List */}
                  <div className="space-y-4">
                    {blog.comments && blog.comments.length > 0 ? (
                      blog.comments.map((comment) => (
                        <div
                          key={comment._id || comment.createdAt}
                          className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4"
                        >
                          <div className="flex items-center space-x-3 mb-2">
                            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                              {comment.user?.username?.[0]?.toUpperCase() || 'U'}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">
                                {comment.user?.username || 'Anonymous'}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(comment.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <p className="text-gray-700 dark:text-gray-200">{comment.content}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-600 dark:text-gray-400">No comments yet. Be the first to comment!</p>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sticky top-24">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Recent Posts</h3>
              <div className="space-y-4">
                {recentBlogs.length > 0 ? (
                  recentBlogs.map((recentBlog) => (
                    <Link
                      key={recentBlog._id}
                      to={`/blog/${recentBlog.slug}`}
                      className="block hover:opacity-80 transition-opacity"
                    >
                      {recentBlog.thumbnail && (
                        <img
                          src={recentBlog.thumbnail}
                          alt={recentBlog.title}
                          className="w-full h-32 object-cover rounded-lg mb-2"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      )}
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2">
                        {recentBlog.title}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {new Date(recentBlog.publishedAt || recentBlog.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No recent posts</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

// Render Tiptap or Slate content (backward compatible)
const BlogContentRenderer = ({ content }) => {
  const tiptapHTML = useMemo(() => {
    if (!content) return null;

    // Check if it's Tiptap format (has type: 'doc')
    if (typeof content === 'object' && content.type === 'doc') {
      try {
        return generateHTML(content, [
          StarterKit.configure({
            link: false, // Exclude link from StarterKit since we add it separately
            underline: false, // Exclude underline to avoid conflicts
          }),
          LinkExtension.configure({
            openOnClick: false,
            HTMLAttributes: {
              class: 'text-blue-500 hover:text-blue-700 underline',
            },
          }),
          Image.configure({
            HTMLAttributes: {
              class: 'max-w-full h-auto rounded-lg my-4',
            },
          }),
        ]);
      } catch (error) {
        console.error('Error rendering Tiptap content:', error);
        return null;
      }
    }
    return null;
  }, [content]);

  if (!content) {
    return <p className="text-gray-600 dark:text-gray-400">No content available</p>;
  }

  // Render Tiptap HTML
  if (tiptapHTML) {
    return (
      <div className="blog-content-wrapper">
        <div
          className="blog-content text-gray-800 dark:text-gray-200"
          dangerouslySetInnerHTML={{ __html: tiptapHTML }}
        />
        <style>{`
          .blog-content-wrapper {
            width: 100%;
          }
          .blog-content {
            line-height: 1.75;
            text-align: left;
          }
          .blog-content h1 {
            font-size: 2.25rem;
            font-weight: 700;
            margin-top: 2rem;
            margin-bottom: 1rem;
            line-height: 1.2;
            color: inherit;
          }
          .blog-content h2 {
            font-size: 1.875rem;
            font-weight: 700;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
            line-height: 1.3;
            color: inherit;
          }
          .blog-content h3 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
            line-height: 1.4;
            color: inherit;
          }
          .blog-content p {
            margin-top: 1rem;
            margin-bottom: 1rem;
            color: inherit;
          }
          .blog-content p:first-child {
            margin-top: 0;
          }
          .blog-content p:last-child {
            margin-bottom: 0;
          }
          .blog-content ul,
          .blog-content ol {
            margin-top: 1rem;
            margin-bottom: 1rem;
            padding-left: 1.5rem;
            color: inherit;
          }
          .blog-content ul {
            list-style-type: disc;
          }
          .blog-content ol {
            list-style-type: decimal;
          }
          .blog-content li {
            margin-top: 0.5rem;
            margin-bottom: 0.5rem;
            color: inherit;
          }
          .blog-content li > p {
            margin-top: 0.5rem;
            margin-bottom: 0.5rem;
          }
          .blog-content a {
            color: #3b82f6;
            text-decoration: underline;
            transition: color 0.2s;
          }
          .blog-content a:hover {
            color: #2563eb;
          }
          .blog-content strong {
            font-weight: 700;
            color: inherit;
          }
          .blog-content em {
            font-style: italic;
            color: inherit;
          }
          .blog-content u {
            text-decoration: underline;
            color: inherit;
          }
          .blog-content img {
            max-width: 100%;
            height: auto;
            border-radius: 0.5rem;
            margin: 1.5rem 0;
            display: block;
          }
          .blog-content blockquote {
            border-left: 4px solid #e5e7eb;
            padding-left: 1rem;
            margin: 1.5rem 0;
            font-style: italic;
            color: #6b7280;
          }
          .blog-content code {
            background-color: #f3f4f6;
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-size: 0.875em;
            font-family: 'Courier New', monospace;
          }
          .blog-content pre {
            background-color: #f3f4f6;
            padding: 1rem;
            border-radius: 0.5rem;
            overflow-x: auto;
            margin: 1.5rem 0;
          }
          .blog-content pre code {
            background-color: transparent;
            padding: 0;
          }
          .dark .blog-content blockquote {
            border-left-color: #4b5563;
            color: #9ca3af;
          }
          .dark .blog-content code {
            background-color: #374151;
            color: #f3f4f6;
          }
          .dark .blog-content pre {
            background-color: #374151;
          }
        `}</style>
      </div>
    );
  }

  // Backward compatibility: Render old Slate format
  if (Array.isArray(content)) {
    return (
      <div>
        {content.map((node, index) => {
          switch (node.type) {
            case 'heading-one':
              return <h1 key={index} className="text-3xl font-bold mb-4">{renderText(node.children)}</h1>;
            case 'heading-two':
              return <h2 key={index} className="text-2xl font-bold mb-3">{renderText(node.children)}</h2>;
            case 'heading-three':
              return <h3 key={index} className="text-xl font-bold mb-2">{renderText(node.children)}</h3>;
            case 'bulleted-list':
              return (
                <ul key={index} className="list-disc list-inside mb-4">
                  {node.children?.map((item, idx) => (
                    <li key={idx}>{renderText(item.children)}</li>
                  ))}
                </ul>
              );
            case 'numbered-list':
              return (
                <ol key={index} className="list-decimal list-inside mb-4">
                  {node.children?.map((item, idx) => (
                    <li key={idx}>{renderText(item.children)}</li>
                  ))}
                </ol>
              );
            case 'link':
              return (
                <a key={index} href={node.url} className="text-blue-500 hover:underline">
                  {renderText(node.children)}
                </a>
              );
            case 'table':
              return (
                <table key={index} className="border-collapse border border-gray-300 dark:border-gray-600 my-4 w-full">
                  <tbody>
                    {node.children?.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {row.children?.map((cell, cellIdx) => (
                          <td key={cellIdx} className="border border-gray-300 dark:border-gray-600 px-4 py-2">
                            {renderText(cell.children)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            case 'iframe':
              return (
                <iframe
                  key={index}
                  src={node.url}
                  className="w-full h-64 my-4"
                  frameBorder="0"
                  allowFullScreen
                  title="Embedded content"
                />
              );
            default:
              return <p key={index} className="mb-4 text-gray-800 dark:text-gray-200">{renderText(node.children)}</p>;
          }
        })}
      </div>
    );
  }

  return <p className="text-gray-600 dark:text-gray-400">Invalid content format</p>;
};

const renderText = (children) => {
  if (!children || !Array.isArray(children)) return '';
  return children.map((child, idx) => {
    if (typeof child === 'string') return <span key={idx} className="text-gray-800 dark:text-gray-200">{child}</span>;
    let text = child.text || '';
    const className = "text-gray-800 dark:text-gray-200";
    if (child.bold) text = <strong key={idx} className={className}>{text}</strong>;
    if (child.italic) text = <em key={idx} className={className}>{text}</em>;
    if (child.underline) text = <u key={idx} className={className}>{text}</u>;
    return text || <span key={idx} className={className}></span>;
  });
};

export default BlogDetail;
